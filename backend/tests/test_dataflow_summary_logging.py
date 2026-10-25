from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from backend.dataflow.utils.DataflowSummaryHelpers import DataflowSummaryHelpers
from backend.utils.log.dataflow_summary_logging import render_summary_text, write_dataflow_summary


class DataflowSummaryLoggingTests(TestCase):
    def test_shared_stage_summary_is_marked_prepared_until_publication_commits(self):
        helper = SimpleNamespace(
            summaryEnabled=True,
            summaryFlushed=False,
            summaryStartTime=1.0,
            run_id=41,
            _publication=object(),
            _owns_publication=False,
        )
        with patch(
            "backend.dataflow.utils.DataflowSummaryHelpers.write_dataflow_summary"
        ) as write_summary:
            DataflowSummaryHelpers.flush_summary(helper, successful=True)

        summary = write_summary.call_args.args[0]
        self.assertTrue(summary["successful"])
        self.assertTrue(summary["publication_pending"])
        self.assertIn(
            "Result: STAGED (PUBLICATION PENDING)", render_summary_text(summary)
        )

    def test_prepared_summary_is_written_outside_the_successful_directory(self):
        summary = {
            "name": "NowPlayingsUpdate",
            "run_id": 41,
            "attempt": 1,
            "successful": True,
            "publication_pending": True,
            "started_at": 1.0,
            "finished_at": 2.0,
            "duration_seconds": 1.0,
        }
        with TemporaryDirectory() as directory, patch(
            "backend.utils.log.dataflow_summary_logging.ARTIFACT_ROOT",
            Path(directory),
        ):
            written = write_dataflow_summary(summary, successful=True)
            self.assertIsNotNone(written)
            self.assertIn("/prepared/", written)
            self.assertIn(
                "Result: STAGED (PUBLICATION PENDING)", Path(written).read_text()
            )
