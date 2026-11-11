from io import StringIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from rich.console import Console

from backend.utils.console import stage_progress


class StageProgressTests(TestCase):
    def test_historical_estimate_loads_for_current_machine_and_weekday(self):
        client = object()
        with patch.dict(
            "os.environ",
            {
                "RUNNER_MACHINE": "mac-studio",
                "SUPABASE_URL": "https://example.test",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
        ), patch("backend.utils.log.job_lease.create_client", return_value=client), patch.object(
            stage_progress, "current_weekday", return_value="wednesday"
        ), patch.object(
            stage_progress, "load_recent_averages", return_value={"Publish:Soons": 42.5}
        ) as load:
            self.assertEqual(stage_progress.load_stage_estimate("Publish:Soons"), 42.5)

        self.assertEqual(load.call_args.args, (client, ["Publish:Soons"], "mac-studio", "wednesday"))

    def test_missing_history_uses_sixty_second_fallback(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(stage_progress.load_stage_estimate("UnknownStage"), 60.0)

    def test_timing_write_uses_existing_rpc_history_and_is_best_effort(self):
        client = object()
        with patch.dict(
            "os.environ",
            {
                "RUNNER_MACHINE": "mac-studio",
                "SUPABASE_URL": "https://example.test",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
        ), patch("backend.utils.log.job_lease.create_client", return_value=client), patch.object(
            stage_progress, "current_weekday", return_value="wednesday"
        ), patch.object(stage_progress, "append_recent_duration") as append:
            stage_progress.record_stage_duration("RunFinalization", 8.25)

        append.assert_called_once_with(client, "RunFinalization", "mac-studio", "wednesday", 8.25)

        with patch.dict(
            "os.environ",
            {
                "RUNNER_MACHINE": "mac-studio",
                "SUPABASE_URL": "https://example.test",
                "SUPABASE_SERVICE_ROLE_KEY": "service-key",
            },
        ), patch("backend.utils.log.job_lease.create_client", return_value=client), patch.object(
            stage_progress, "append_recent_duration", side_effect=RuntimeError("database unavailable")
        ), self.assertLogs(stage_progress.LOGGER, level="WARNING"):
            stage_progress.record_stage_duration("RunFinalization", 8.25, "wednesday")

    def test_successful_operation_records_one_duration_and_formats_static_output(self):
        output = StringIO()
        console = Console(file=output, force_terminal=False)
        with patch.object(stage_progress, "load_stage_estimate", return_value=10), patch.object(
            stage_progress, "record_stage_duration"
        ) as record, patch.object(stage_progress.time, "monotonic", side_effect=[100.0, 104.5]):
            result = stage_progress.run_timed_stage(
                "SocialPreviewRefresh", "Refresh previews", lambda: {"updated": 3}, console
            )

        self.assertEqual(result, {"updated": 3})
        record.assert_called_once_with("SocialPreviewRefresh", 4.5, stage_progress.current_weekday())
        self.assertIn("Refresh previews", output.getvalue())
        self.assertIn("Complete", output.getvalue())

    def test_failed_or_skipped_operation_does_not_record_history(self):
        console = Console(file=StringIO(), force_terminal=False)
        with patch.object(stage_progress, "load_stage_estimate", return_value=1), patch.object(
            stage_progress, "record_stage_duration"
        ) as record:
            with self.assertRaisesRegex(RuntimeError, "failed"):
                stage_progress.run_timed_stage(
                    "Failure", "Failure", lambda: (_ for _ in ()).throw(RuntimeError("failed")), console
                )
            skipped = stage_progress.run_timed_stage(
                "Cleanup", "Cleanup", lambda: {"skipped": "already-cleaned"}, console,
                record_when=lambda value: not value.get("skipped"),
                outcome_for=lambda value: f"Skipped: {value['skipped']}",
            )

        self.assertEqual(skipped["skipped"], "already-cleaned")
        record.assert_not_called()

    def test_overrun_remains_open_and_explains_the_estimate(self):
        task = SimpleNamespace(elapsed=75.0, fields={"estimate": 60.0, "state": "running"}, completed=0.0)
        self.assertIn("Taking longer than estimated", stage_progress._EstimateColumn().render(task).plain)
        bar = stage_progress._StageBarColumn().render(task)
        self.assertLess(bar.completed, 100)

    def test_live_refresh_stops_when_operation_raises(self):
        console = Console(file=StringIO(), force_terminal=True)
        with patch.object(stage_progress, "load_stage_estimate", return_value=10), patch.object(
            stage_progress, "record_stage_duration"
        ) as record, patch.object(stage_progress.Progress, "start") as start, patch.object(
            stage_progress.Progress, "stop"
        ) as stop:
            with self.assertRaisesRegex(RuntimeError, "failed"):
                stage_progress.run_timed_stage(
                    "Failure", "Failure", lambda: (_ for _ in ()).throw(RuntimeError("failed")), console
                )

        start.assert_called_once()
        stop.assert_called_once()
        record.assert_not_called()

    def test_tables_and_bytes_are_readable(self):
        output = StringIO()
        console = Console(file=output, width=100, force_terminal=False)
        stage_progress.render_key_value_table(
            "Social preview images", [("Scanned", 8), ("Updated", 3), ("Failed", 0)], console
        )
        self.assertIn("Social preview images", output.getvalue())
        self.assertIn("Scanned", output.getvalue())
        self.assertIn("Updated", output.getvalue())
        self.assertEqual(stage_progress.format_bytes(1536000), "1.5 MB")

    def test_table_folds_long_values_in_a_narrow_redirected_terminal(self):
        output = StringIO()
        console = Console(file=output, width=36, force_terminal=False)
        stage_progress.render_key_value_table(
            "Run finalization",
            [("Log/status", "Confirmed in Supabase"), ("Outcome", "Finalization failed or unconfirmed")],
            console,
            status="failed",
        )
        rendered = output.getvalue()
        self.assertIn("Run finalization", rendered)
        self.assertIn("Supabase", rendered)
        self.assertIn("unconfirmed", rendered)
