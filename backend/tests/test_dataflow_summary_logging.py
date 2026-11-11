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

    def test_prepared_summary_is_stored_as_a_d1_artifact(self):
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
        with patch("backend.utils.log.run_storage.RunArtifactStore") as store_class:
            written = write_dataflow_summary(summary, successful=True)
        self.assertEqual(
            written,
            "d1://run_logs/41/dataflow_summary/NowPlayingsUpdate/1/prepared",
        )
        self.assertEqual(store_class.return_value.save_text_artifact.call_args.kwargs["run_id"], 41)
        self.assertIn(
            '"publication_pending":true',
            store_class.return_value.save_text_artifact.call_args.kwargs["text"],
        )
        self.assertTrue(
            store_class.return_value.save_text_artifact.call_args.kwargs["metadata"]["publication_pending"]
        )

    def test_tmdb_metrics_are_visible_in_compact_summary_text(self):
        text = render_summary_text({
            "name": "NowPlayingsTmdb",
            "run_id": 41,
            "attempt": 1,
            "successful": True,
            "tmdb_metrics": {
                "scope": "shared_run_cumulative",
                "tmdb_search_http_requests": 4,
                "tmdb_movie_detail_http_requests": 2,
                "tmdb_in_memory_hits": 3,
                "tmdb_run_cache_detail_hits": 1,
                "tmdb_persistent_detail_hits": 7,
                "tmdb_archived_movie_count": 6,
            },
        })
        self.assertIn("Network requests: 6 total | search=4 | details=2 | other=0", text)
        self.assertIn("in_memory=3 | run_cache=1 | persistent=7", text)
        self.assertIn("Archived films covered: 6 unique", text)
