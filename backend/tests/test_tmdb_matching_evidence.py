from unittest import TestCase

from backend.dataflow.nowplayings.NowPlayingsTmdb import NowPlayingsTmdb
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext, DataflowRequests, TMDB_MOVIE_DETAILS_PARAMS
from backend.dataflow.utils.DataflowSummaryHelpers import DataflowSummaryHelpers
from backend.dataflow.utils.PipelineCheckpoints import stable_fingerprint
from backend.dataflow.utils.ProviderFreshness import observation


class MatchingEvidenceTests(TestCase):
    def flow(self):
        flow = NowPlayingsTmdb.__new__(NowPlayingsTmdb)
        context = DataflowRequestContext()
        flow.run_id = 300
        flow._artifact_attempt = 2
        flow.summaryStartTime = 1.0
        flow.init_dataflow_summary_state()
        flow.initDataflowRequests(context)
        self.addCleanup(flow.closeDataflowRequests)
        return flow

    def test_records_every_source_signal_candidate_and_the_complete_override_path(self):
        flow = self.flow()
        rows = [
            {"id": "source-a", "snapshot_id": "snap-a", "run_id": 290, "cinema": "Cinema A",
             "english_title": "Arrival", "hebrew_title": "הגעה", "release_year": 2016,
             "release_date": "2024-06-01", "directed_by": "Denis Villeneuve", "runtime": 116},
            {"id": "source-b", "snapshot_id": "snap-b", "run_id": 291, "cinema": "Cinema B",
             "english_title": "Arrival: The Return", "hebrew_title": "הגעה חוזרת", "release_year": 2024,
             "release_date": "2024-07-01", "directed_by": "Another Director", "runtime": 120},
        ]
        flow.beginTmdbMatchEvidence(
            "identity-arrival",
            rows,
            input_fingerprint=stable_fingerprint(rows),
        )
        flow.candidates = [11, 12]
        flow.details = {
            11: {"id": 11, "title": "Arrival", "original_title": "L'Arrivée", "release_date": "2016-03-11",
                 "runtime": 116, "external_ids": {}, "credits": {"crew": [{"name": "Denis Villeneuve", "job": "Director"}]}, "videos": {"results": []}},
            12: {"id": 12, "title": "Arrival: The Return", "original_title": "Arrival: The Return", "release_date": "2024-08-01",
                 "runtime": 120, "external_ids": {}, "credits": {"crew": [{"name": "Another Director", "job": "Director"}]}, "videos": {"results": []}},
        }
        params = {"query": "Arrival", "primary_release_year": 2016, "page": 1}
        flow._request_context.tmdb_observations[("search/movie", tuple(sorted(params.items())))] = observation("success", "usable_response")
        flow.recordTmdbSearchResponse(params, {
            "results": [
                {"id": 11, "title": "Arrival", "original_title": "L'Arrivée", "release_date": "2016-03-11"},
                {"id": 12, "title": "Arrival: The Return", "original_title": "Arrival: The Return", "release_date": "2024-08-01"},
            ],
            "total_pages": 4,
        })
        for tmdb_id in (11, 12):
            key = (f"movie/{tmdb_id}", tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())))
            flow._request_context.tmdb_observations[key] = observation("success", "usable_response", {"tmdb_id": str(tmdb_id)})

        # The existing matcher can emit a provisional match before applying an alias.
        flow.trace_event("tmdb_choice", "mapped", "title_first_match", payload={"chosen_tmdb": 11})
        self.assertIsNotNone(flow._tmdb_current_match_evidence)
        flow.trace_event("tmdb_choice", "mapped", "alias_remap", payload={"chosen_tmdb": 12, "chosen_path": "alias_remap"})
        flow.finishTmdbMatchEvidence("alias_remap", "mapped", 12, chosen_path="alias_remap", candidate_ids=flow.candidates)

        evidence = flow.summaryTmdbEvidence[0]
        self.assertEqual(evidence["run_id"], 300)
        self.assertEqual(evidence["attempt"], 2)
        self.assertEqual(evidence["category"], "nowplayings")
        self.assertEqual(evidence["input_fingerprint"], stable_fingerprint(rows))
        self.assertEqual(len(evidence["source_rows"]), 2)
        self.assertEqual(evidence["chosen_path"], "alias_remap")
        self.assertEqual(evidence["chosen_tmdb_id"], 12)
        self.assertEqual([event["reason"] for event in evidence["decisions"]], ["title_first_match", "alias_remap"])
        self.assertEqual(evidence["candidates"][0]["search_positions"][0]["position_on_page"], 1)
        self.assertEqual(evidence["candidates"][0]["original_title"], "L'Arrivée")
        self.assertEqual(evidence["candidates"][0]["directors"], ["Denis Villeneuve"])
        self.assertEqual(evidence["candidates"][0]["runtime"], 116)
        self.assertTrue(evidence["candidates"][0]["response_validation"]["canonical_profile_valid"])
        self.assertIn("videos.results", evidence["candidates"][0]["response_validation"]["empty_sections"])
        self.assertNotIn("details.videos.results", evidence["candidates"][0]["missing_evidence"])
        self.assertEqual(evidence["candidates"][0]["comparisons"]["year"][1]["signal"], "conflict")
        self.assertEqual(evidence["candidates"][0]["comparisons"]["director"][1]["signal"], "conflict")
        self.assertEqual(evidence["candidates"][0]["comparisons"]["runtime"][1]["difference_minutes"], 4)
        self.assertIn("title", evidence["candidates"][0]["conflicting_evidence"])
        self.assertEqual(evidence["candidates"][1]["title"], "Arrival: The Return")

    def test_unresolved_attempt_and_search_failure_are_persistable_evidence(self):
        flow = self.flow()
        flow.beginTmdbMatchEvidence("missing-result", [{"id": "raw-1", "cinema": "Cinema C", "english_title": "Unknown Film"}])
        params = {"query": "Unknown Film", "page": 1}
        key = ("search/movie", tuple(sorted(params.items())))
        flow._request_context.tmdb_observations[key] = observation("failed", "request_failed")
        flow.recordTmdbSearchResponse(params, {})
        flow.trace_event("tmdb_search", "dropped", "no_candidates", payload={"chosen_tmdb": None})
        result = flow.summaryTmdbEvidence[0]
        self.assertEqual(result["status"], "dropped")
        self.assertEqual(result["selection_reason"], "no_candidates")
        self.assertEqual(result["search_requests"][0]["outcome"], "failed")
        self.assertEqual(result["candidates"], [])

    def test_shared_run_metrics_are_copied_without_consuming_archived_coverage(self):
        flow = self.flow()
        flow._tmdb_metrics.update({"tmdb_movie_detail_http_requests": 2, "tmdb_archived_movie_ids": {11, 12}})
        self.assertEqual(flow._summaryTmdbMetrics()["tmdb_archived_movie_count"], 2)
        self.assertEqual(flow._summaryTmdbMetrics()["tmdb_archived_movie_count"], 2)
        self.assertEqual(flow._summaryTmdbMetrics()["tmdb_movie_detail_http_requests"], 2)


if __name__ == "__main__":
    import unittest
    unittest.main()
