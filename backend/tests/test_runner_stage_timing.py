from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.config import runners


class RunnerStageTimingTests(TestCase):
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
