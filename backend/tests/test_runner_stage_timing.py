from types import SimpleNamespace
from io import StringIO
import logging
from unittest import TestCase
from unittest.mock import patch

from backend.config import runners
from backend.utils.console.stage_progress import report_work
from rich.console import Console


class RunnerStageTimingTests(TestCase):
    def test_worker_reports_real_work_to_runner_callback(self):
        dispatcher = type("Dispatcher", (), {})
        updates = []
        spec = SimpleNamespace(
            make_instance=lambda *_: SimpleNamespace(),
            run_instance=lambda _: report_work(2, 4, "recipients"),
            cleanup=lambda _: None,
            on_work_progress=lambda *args: updates.append(args),
        )
        self.assertTrue(runners._run_attempt(spec, dispatcher, "alerts", 7, 1).ok)
        self.assertEqual(updates, [(dispatcher, 2, 4, "recipients")])

    def test_work_reporting_preserves_transport_callback(self):
        dispatcher = type("Dispatcher", (), {})
        updates = []
        spec = SimpleNamespace(
            make_instance=lambda *_: SimpleNamespace(),
            run_instance=lambda instance: instance._timing_transport_callback("requests", 1),
            cleanup=lambda _: None,
            on_transport_change=lambda *args: updates.append(args),
            on_work_progress=lambda *_: self.fail("transport sent to work callback"),
        )
        self.assertTrue(runners._run_attempt(spec, dispatcher, "alerts", 7, 1).ok)
        self.assertEqual(updates[0][:3], (dispatcher, "requests", 1))

    def test_publication_metrics_render_muted_tables_and_restore_logger_on_failure(self):
        logger = logging.getLogger("backend.dataflow.utils.PostgresPublicationPublisher")
        original = (logger.level, logger.propagate, list(logger.handlers))
        output = StringIO()
        def commit():
            logger.info('publication_metric={"event":"publication_stage_complete","parts":36,"payload_bytes":3736557}')
            logger.warning("A warning")
            raise RuntimeError("apply failed")
        with self.assertRaisesRegex(RuntimeError, "apply failed"):
            runners._commit_publication_with_progress(SimpleNamespace(commit=commit), "movies", Console(file=output, width=100))
        rendered = output.getvalue()
        self.assertIn("Publication · stage complete", rendered)
        self.assertIn("Parts", rendered)
        self.assertIn("36", rendered)
        self.assertIn("3736557", rendered)
        self.assertIn("A warning", rendered)
        self.assertNotIn("publication_metric=", rendered)
        self.assertEqual((logger.level, logger.propagate, logger.handlers), original)

    def test_successful_post_stage_dispatcher_records_timing_once(self):
        dispatcher = type("MovieNotificationDispatcher", (), {})
        instance = SimpleNamespace(_notification_summary={"emails_sent": 2})
        spec = SimpleNamespace(
            make_instance=lambda *_args: instance,
            run_instance=lambda _instance: None,
            cleanup=lambda _instance: None,
        )
        with patch.object(runners, "record_stage_duration") as record, patch.object(
            runners, "current_weekday", return_value="wednesday"
        ):
            result = runners._run_attempt(spec, dispatcher, "alerts", 7, 1)

        self.assertTrue(result.ok)
        self.assertEqual(result.detail, {"emails_sent": 2})
        record.assert_called_once()
        self.assertEqual(record.call_args.args[0], "MovieNotificationDispatcher")
        self.assertGreater(record.call_args.args[1], 0)
        self.assertEqual(record.call_args.args[2], "wednesday")

    def test_failed_dispatcher_does_not_record_timing(self):
        dispatcher = type("MovieNotificationDispatcher", (), {})
        instance = SimpleNamespace()
        spec = SimpleNamespace(
            make_instance=lambda *_args: instance,
            run_instance=lambda _instance: (_ for _ in ()).throw(RuntimeError("delivery failed")),
            cleanup=lambda _instance: None,
        )
        with patch.object(runners, "record_stage_duration") as record, patch.object(
            runners, "artifactPrinting"
        ):
            result = runners._run_attempt(spec, dispatcher, "alerts", 7, 1)

        self.assertFalse(result.ok)
        record.assert_not_called()
