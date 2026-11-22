from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.config.runners import _run_shared_update_round
from backend.dataflow.cinematheques.CinemathequesUpdate import CinemathequesUpdate
from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate
from backend.dataflow.utils.ArchivedRatingsCache import ARCHIVED_RATINGS_TABLE, ArchivedRatingsCache, is_archived_row
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow
from backend.dataflow.utils.ProviderFreshness import observation
from dataflow_database import DB


NOW = datetime(2026, 11, 22, tzinfo=timezone.utc)
ROW = {"tmdb_id": 101, "release_year": 1987, "imdb_id": "tt101", "english_title": "Example"}
TMDB = {"release_date": "1987-03-06", "external_ids": {"imdb_id": "tt101"}}


class ArchivedRatingsCacheTests(TestCase):
    def flow(self, db, cls=NowPlayingsUpdate, *, context=None):
        flow = cls.__new__(cls)
        flow._shared_request_context = context
        InitializeBaseDataflow.__init__(flow)
        self.addCleanup(flow.closeDataflowRequests)
        flow._publication = SimpleNamespace(client=db)
        flow._update_tmdb = {101: TMDB}
        flow.solo_update_only = False
        flow._imdb_ratings = {}
        return flow

    def prepare(self, flow, rows=(ROW,), now=NOW):
        flow._archived_ratings = ArchivedRatingsCache(flow, rows, now=now)
        return flow._archived_ratings

    def update(self, flow, row=ROW):
        out = dict(row)
        flow.startProviderFreshness(row, out)
        flow.updateMovieRatings(row, out, flow.updating_existing_values(row), row["tmdb_id"])
        return out

    def test_uses_original_date_and_jerusalem_year_boundary(self):
        row = {**ROW, "release_date": "2029-12-01"}
        self.assertTrue(is_archived_row(row, {"release_date": "2023-12-31"}, now=NOW))
        self.assertFalse(is_archived_row(row, {"release_date": "2024-01-01"}, now=NOW))
        boundary = datetime(2026, 12, 31, 22, tzinfo=timezone.utc)
        self.assertTrue(is_archived_row(row, {"release_date": "2024-01-01"}, now=boundary))
        self.assertTrue(is_archived_row(row, {"release_date": ""}, now=NOW))
        self.assertFalse(is_archived_row({"release_year": 0, "release_date": "1987-06-01"}, now=NOW))

    def test_legacy_scores_and_no_listing_survive_film_removal(self):
        scored_row = {
            **ROW, "imdbRating": 7.2, "imdbVotes": 600,
            "rt_id": "/m/example", "rtCriticRating": 0, "rtCriticVotes": 0,
            "provider_freshness": {"letterboxd": {"outcome": "no_listing", "reason": "http_404"}},
        }
        db = DB({"finalMovies": [scored_row]})
        first = self.flow(db, CinemathequesUpdate)
        self.prepare(first)
        db.tables["finalMovies"].clear()
        returning = self.flow(db)
        self.prepare(returning)
        returning.imdbRatingsPath = Mock(side_effect=AssertionError("IMDb dataset should not open"))
        returning.updateLetterboxd = Mock(side_effect=AssertionError("known missing listing"))
        returning.updateRottenTomatoes = Mock(side_effect=AssertionError("scores already saved"))
        self.assertEqual(returning.loadImdbRatings([ROW]), {})
        result = self.update(returning)
        self.assertEqual((result["imdbRating"], result["imdbVotes"]), (7.2, 600))
        self.assertEqual((result["rtCriticRating"], result["rtCriticVotes"]), (0, 0))
        self.assertEqual(result["rt_id"], "/m/example")
        self.assertEqual(result["provider_freshness"]["letterboxd"]["source"]["cached_outcome"], "no_listing")

    def test_shared_rows_reuse_the_first_provider_result(self):
        db = DB({})
        first = self.flow(db)
        second = self.flow(db, CinemathequesUpdate)
        second._archived_ratings = self.prepare(first)
        lb = Mock()
        rt = Mock()

        def letterboxd(flow, row):
            lb()
            row["lbRating"] = 4.0
            flow.recordProviderFreshness(row, "letterboxd", observation("success", "partial_fields"), ["lbRating"])

        def rotten_tomatoes(flow, row):
            rt()
            flow.recordProviderFreshness(row, "rotten_tomatoes", observation("no_score", "listing_without_score"))

        for flow in (first, second):
            flow.updateLetterboxd = lambda row, _, __, flow=flow: letterboxd(flow, row)
            flow.updateRottenTomatoes = lambda row, _, flow=flow: rotten_tomatoes(flow, row)
            flow._imdb_observation = observation("success", "dataset_validated")
            flow._imdb_ratings = {"tt101": {"rating": 7.4, "votes": 12}}

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(self.update, (first, second)))
        lb.assert_called_once()
        rt.assert_called_once()
        self.assertEqual([result["lbRating"] for result in results], [4.0, 4.0])
        self.assertEqual([result["imdbRating"] for result in results], [7.4, 7.4])
        self.assertEqual(len(db.tables[ARCHIVED_RATINGS_TABLE]), 3)

    def test_temporary_failure_is_retried_after_cooldown_with_a_limit(self):
        db = DB({})
        flow = self.flow(db)

        def check_letterboxd(row, *_):
            event = observation("rate_limited", "http_429")
            event["attempted_at"] = current.isoformat()
            flow.recordProviderFreshness(row, "letterboxd", event)

        flow.updateLetterboxd = Mock(side_effect=check_letterboxd)
        flow.updateRottenTomatoes = Mock()
        for day, expected in [(0, 1), (6, 1), (7, 2), (14, 3), (60, 3)]:
            current = NOW + timedelta(days=day)
            self.prepare(flow, now=current)
            self.update(flow)
            self.assertEqual(flow.updateLetterboxd.call_count, expected)

    def test_missing_imdb_id_can_be_checked_when_it_becomes_known(self):
        db = DB({})
        flow = self.flow(db)
        flow._update_tmdb = {101: {"release_date": TMDB["release_date"]}}
        row = {**ROW, "imdb_id": ""}
        self.assertFalse(self.prepare(flow, [row]).should_check_imdb(101))
        flow._update_tmdb = {101: TMDB}
        self.assertTrue(self.prepare(flow, [row]).should_check_imdb(101))

    def test_cache_unavailability_keeps_saved_ratings_and_defers_calls(self):
        flow = self.flow(Mock())
        row = {**ROW, "lbRating": 3.5}
        self.prepare(flow, [row])
        flow.solo_update_only = True
        flow.updateLetterboxd = Mock(side_effect=AssertionError("cache unavailable"))
        flow.updateRottenTomatoes = Mock(side_effect=AssertionError("cache unavailable"))
        self.assertEqual(self.update(flow, row)["lbRating"], 3.5)

    def test_runner_and_standalone_pass_skip_imdb_when_only_resolved_ids_remain(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                db = DB({"finalMovies": [{**ROW, "lbRating": 1.5, "rtCriticRating": 10, "imdbRating": 4.1}]})
                context = DataflowRequestContext()
                self.addCleanup(context.close)
                flow = self.flow(db, context=context)
                flow.run_id = 1
                flow.beginSharedUpdate = Mock(return_value=[ROW])
                flow.finishSharedUpdate = Mock()
                flow.finishSharedDataRun = Mock()
                flow.prepareUpdateTmdb = Mock()
                flow.imdbRatingsPath = Mock(side_effect=AssertionError("no outstanding IMDb IDs"))
                flow.process_row = Mock(side_effect=lambda row: self.update(flow, row))
                if shared:
                    with patch.dict("backend.config.runners.dataflowDictionary", {"make_instance": Mock(return_value=flow)}):
                        result = _run_shared_update_round([("nowPlayingData", NowPlayingsUpdate)], 1, 1, context)
                    self.assertTrue(result[NowPlayingsUpdate].ok)
                else:
                    flow.logic()
                flow.imdbRatingsPath.assert_not_called()
                self.assertEqual(flow.finishSharedUpdate.call_args.args[1][0]["imdbRating"], 4.1)
