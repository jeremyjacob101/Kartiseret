from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.dataflow.utils.InitializeBaseDataflow import logSuccessfulRun as log_dataflow_run
from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace
from backend.utils.log.cloudflare_storage import LeaseLostError
from backend.scraping.utils.InitializeBaseCinema import logSuccessfulRun as log_scrape_run
from backend.utils.util_avg_time_history import (
    APPEND_RPC,
    TRANSPORT_APPEND_RPC,
    average_recent_times,
    load_recent_averages,
    weekday_at,
    append_recent_duration,
)


class UtilAvgTimeHistoryTests(TestCase):
    def test_average_uses_only_the_five_newest_valid_durations(self):
        self.assertEqual(average_recent_times([1, 2, 3, 4, 5, 6]), 4.0)
        self.assertAlmostEqual(average_recent_times([1, "bad", 3, 0, float("inf")]), 2.0)

    def test_missing_and_invalid_history_has_no_average(self):
        for value in (None, [], {}, [None, 0, -1, float("nan"), float("inf"), "bad"]):
            with self.subTest(value=value):
                self.assertIsNone(average_recent_times(value))

    def test_weekday_uses_jerusalem_date_even_across_utc_midnight(self):
        instant = datetime(2026, 11, 2, 22, 30, tzinfo=timezone.utc)
        self.assertEqual(weekday_at(instant), "tuesday")
        with self.assertRaisesRegex(ValueError, "timezone"):
            weekday_at(datetime(2026, 11, 2, 22, 30))

    def test_average_lookup_filters_by_machine_weekday_and_runner(self):
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.in_.return_value = query
        query.execute.return_value = SimpleNamespace(
            data=[
                {"name": "Alpha", "recent_times": [10, 20, 30]},
                {"name": "Beta", "recent_times": []},
                {"name": "Gamma", "recent_times": [float("nan")]},
            ]
        )
        client = Mock()
        client.table.return_value = query

        averages = load_recent_averages(client, ["Alpha", "Beta", "Gamma"], "m5_mac", "tuesday")

        self.assertEqual(averages, {"Alpha": 20.0})
        client.table.assert_called_once_with("utilAvgTimeHistory")
        query.eq.assert_any_call("runner_machine", "m5_mac")
        query.eq.assert_any_call("weekday", "tuesday")
        query.eq.assert_any_call('transport', 'legacy')
        query.in_.assert_called_once_with("name", ["Alpha", "Beta", "Gamma"])

    def test_average_lookup_returns_empty_for_missing_scope(self):
        client = Mock()
        self.assertEqual(load_recent_averages(client, [], "m5_mac", "tuesday"), {})
        self.assertEqual(load_recent_averages(client, ["Alpha"], None, "tuesday"), {})
        self.assertEqual(load_recent_averages(client, ["Alpha"], "m5_mac", "TUESDAY"), {})
        client.table.assert_not_called()

    def test_append_uses_atomic_database_rpc_and_validates_duration(self):
        client = Mock()

        append_recent_duration(client, "Alpha", "intel_mac", "monday", 12.5)

        client.rpc.assert_called_once_with(
            APPEND_RPC,
            {
                "p_name": "Alpha",
                "p_runner_machine": "intel_mac",
                "p_weekday": "monday",
                "p_duration": 12.5,
            },
        )
        client.rpc.return_value.execute.assert_called_once_with()
        for invalid in (None, 0, -1, float("inf"), float("nan")):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                append_recent_duration(client, "Alpha", "intel_mac", "monday", invalid)
        client.rpc.assert_called_once()

    def test_scrape_and_dataflow_record_their_captured_start_weekday(self):
        with patch.dict("os.environ", {"RUNNER_MACHINE": "intel_mac", "SOLO_UPDATE_ONLY": "0"}):
            for logger, module_name, runner_name in (
                (log_scrape_run, "backend.scraping.utils.InitializeBaseCinema", "Cinema"),
                (log_dataflow_run, "backend.dataflow.utils.InitializeBaseDataflow", "Dataflow"),
            ):
                with self.subTest(runner=runner_name):
                    runner = type(runner_name, (), {})()
                    runner.startTime = 5.0
                    runner._timing_weekday = "sunday"
                    runner.supabase = Mock()
                    with patch(f"{module_name}.runningGithubActions", False), patch(
                        f"{module_name}.time.perf_counter", return_value=17.0
                    ), patch(f"{module_name}.append_recent_duration") as record:
                        logger(runner)
                    record.assert_called_once_with(
                        runner.supabase, runner_name, "intel_mac", "sunday", 12.0,
                        **({'transport': 'legacy'} if runner_name == 'Cinema' else {}),
                    )

    def test_transport_append_uses_separate_rpc_scope(self):
        for transport in ('requests', 'selenium', 'requests_selenium_fallback'):
            client = Mock()
            append_recent_duration(client, 'Cinema', 'm5_mac', 'monday', 20, transport=transport)
            client.rpc.assert_called_once_with(TRANSPORT_APPEND_RPC, {
                'p_name': 'Cinema', 'p_runner_machine': 'm5_mac',
                'p_weekday': 'monday', 'p_duration': 20.0, 'p_transport': transport,
            })

    def test_transport_lookup_never_combines_legacy_or_other_transports(self):
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.in_.return_value = query
        query.execute.return_value.data = [{'name': 'Cinema', 'recent_times': [3, 5]}]
        client = Mock()
        client.table.return_value = query
        self.assertEqual(load_recent_averages(client, ['Cinema'], 'm5_mac', 'monday', transport='requests'), {'Cinema': 4})
        query.eq.assert_any_call('transport', 'requests')

    def test_unknown_transport_cannot_read_or_write_history(self):
        client = Mock()
        with self.assertRaisesRegex(ValueError, 'transport'):
            append_recent_duration(client, 'Cinema', 'm5_mac', 'monday', 20, transport='auto')
        with self.assertRaisesRegex(ValueError, 'transport'):
            load_recent_averages(client, ['Cinema'], 'm5_mac', 'monday', transport='auto')
        client.table.assert_not_called()
        client.rpc.assert_not_called()

    def test_scraper_logs_actual_success_transport_and_fallback_inclusive_duration(self):
        for transport in ('requests', 'selenium', 'requests_selenium_fallback'):
            runner = type('Cinema', (), {})()
            runner.startTime, runner._timing_weekday = 5.0, 'sunday'
            runner._timing_transport, runner.supabase = transport, Mock()
            with patch.dict('os.environ', {'RUNNER_MACHINE': 'intel_mac'}), patch('backend.scraping.utils.InitializeBaseCinema.runningGithubActions', False), patch('backend.scraping.utils.InitializeBaseCinema.time.perf_counter', return_value=17), patch('backend.scraping.utils.InitializeBaseCinema.append_recent_duration') as record:
                log_scrape_run(runner)
            record.assert_called_once_with(runner.supabase, 'Cinema', 'intel_mac', 'sunday', 12, transport=transport)

    def test_timing_outage_is_advisory_after_successful_scrape(self):
        runner = SimpleNamespace(startTime=1, _timing_weekday='monday', _timing_transport='requests', supabase=Mock())
        with patch.dict('os.environ', {'RUNNER_MACHINE': 'intel_mac'}), patch('backend.scraping.utils.InitializeBaseCinema.runningGithubActions', False), patch('backend.scraping.utils.InitializeBaseCinema.append_recent_duration', side_effect=RuntimeError('RPC unavailable')), self.assertLogs('backend.scraping.utils.InitializeBaseCinema', level='WARNING'):
            log_scrape_run(runner)

    def test_timing_write_does_not_swallow_lease_loss(self):
        runner = SimpleNamespace(startTime=1, _timing_weekday='monday', _timing_transport='requests', supabase=Mock())
        with patch.dict('os.environ', {'RUNNER_MACHINE': 'intel_mac'}), patch('backend.scraping.utils.InitializeBaseCinema.runningGithubActions', False), patch('backend.scraping.utils.InitializeBaseCinema.append_recent_duration', side_effect=LeaseLostError('lease lost')), self.assertRaises(LeaseLostError):
            log_scrape_run(runner)

    def test_solo_update_does_not_record_dataflow_duration(self):
        runner = type("Dataflow", (), {})()
        runner.startTime = 5.0
        runner._timing_weekday = "sunday"
        runner.supabase = Mock()
        with patch.dict("os.environ", {"RUNNER_MACHINE": "intel_mac", "SOLO_UPDATE_ONLY": "true"}), patch(
            "backend.dataflow.utils.InitializeBaseDataflow.runningGithubActions", False
        ), patch("backend.dataflow.utils.InitializeBaseDataflow.append_recent_duration") as record:
            log_dataflow_run(runner)
        record.assert_not_called()

    def test_publication_workspace_forwards_timing_rpc_to_supabase(self):
        client = Mock()
        workspace = PublicationWorkspace("nowplayings", 1, client=client)
        params = {"p_name": "Alpha", "p_runner_machine": "intel_mac", "p_weekday": "monday", "p_duration": 1.0}

        workspace.rpc(APPEND_RPC, params).execute()

        client.rpc.assert_called_once_with(APPEND_RPC, params)
        client.rpc.return_value.execute.assert_called_once_with()


if __name__ == "__main__":
    import unittest

    unittest.main()
