from copy import deepcopy
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock, patch
import gzip
import json

from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate
from backend.dataflow.comingsoons.ComingSoonsUpdate import ComingSoonsUpdate
from backend.dataflow.cinematheques.CinemathequesUpdate import CinemathequesUpdate
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow
from backend.dataflow.utils.DataflowRequests import DataflowRequestError, TMDB_MOVIE_DETAILS_PARAMS
from backend.dataflow.utils.ProviderFreshness import observation
from test_dataflow_requests import Client, response


class ProviderFreshnessTests(TestCase):
    def flow(self, cls=NowPlayingsUpdate, solo=False):
        flow = cls.__new__(cls)
        InitializeBaseDataflow.__init__(flow)
        self.addCleanup(flow.closeDataflowRequests)
        flow.solo_update_only, flow.run_id, flow.TMDB_API_KEY = solo, 1, "fixture-secret"
        flow._imdb_ratings = {}
        return flow

    def row(self):
        return {"tmdb_id": 101, "english_title": "Title with a typo", "release_year": 2026,
                "rt_id": "/m/kept", "rtCriticRating": 70, "rtCriticVotes": 100,
                "rtAudienceRating": 80, "rtAudienceVotes": 200, "lbRating": 3.5, "lbVotes": 500,
                "imdb_id": "tt101", "imdbRating": 8.0, "imdbVotes": 2000, "solo_update": True}

    def rt(self, flow, row, scorecard):
        flow.startProviderFreshness(row, row)
        flow.requestGet = Mock(side_effect=[response(b'<search-page/>'), response(('<script id="media-scorecard-json">' + json.dumps(scorecard) + '</script>').encode())])
        flow.updateRottenTomatoes(row, flow.updating_existing_values(row))

    def test_zero_partial_success_then_blocked_retains_field_provenance(self):
        for cls in (NowPlayingsUpdate, CinemathequesUpdate):
            with self.subTest(cls=cls):
                flow, row = self.flow(cls), self.row()
                self.rt(flow, row, {"criticsScore": {"score": 0, "ratingCount": 0}})
                state = row["provider_freshness"]["rotten_tomatoes"]
                self.assertEqual((row["rtCriticRating"], row["rtCriticVotes"]), (0, 0))
                self.assertEqual(state["reason"], "partial_fields")
                self.assertEqual(state["fields"]["rtAudienceRating"]["state"], "unverified")
                last_success = state["last_success_at"]
                observed = deepcopy(state["fields"]["rtCriticRating"])
                original = deepcopy(row)
                flow.startProviderFreshness(original, row)
                flow.requestGet = Mock(side_effect=DataflowRequestError("secret URL must not persist", status=403))
                flow.updateRottenTomatoes(row, flow.updating_existing_values(row))
                state = row["provider_freshness"]["rotten_tomatoes"]
                self.assertEqual(state["outcome"], "blocked")
                self.assertEqual(state["last_success_at"], last_success)
                self.assertGreaterEqual(state["attempted_at"], last_success)
                self.assertEqual(state["fields"]["rtCriticRating"]["observed_at"], observed["observed_at"])
                self.assertEqual(state["fields"]["rtCriticRating"]["state"], "retained")
                self.assertEqual(row["rtCriticRating"], 0)
                self.assertNotIn("secret URL", json.dumps(state))

    def test_no_score_parse_failure_and_no_listing_are_different(self):
        flow = self.flow()
        row = self.row()
        self.rt(flow, row, {"criticsScore": {}})
        self.assertEqual(row["provider_freshness"]["rotten_tomatoes"]["outcome"], "no_score")
        self.assertNotIn("last_success_at", row["provider_freshness"]["rotten_tomatoes"])
        flow.requestGet = Mock(return_value=response(b'changed HTML'))
        flow.updateRottenTomatoes(row, flow.updating_existing_values(row))
        self.assertEqual(row["provider_freshness"]["rotten_tomatoes"]["outcome"], "parse_error")
        row["rt_id"] = ""
        flow.requestGet = Mock(return_value=response(b'<search-page/>'))
        flow.updateRottenTomatoes(row, flow.updating_existing_values(row))
        self.assertEqual(row["provider_freshness"]["rotten_tomatoes"]["outcome"], "no_listing")

    def test_letterboxd_zero_partial_values_and_resolution_block(self):
        flow, row = self.flow(), self.row()
        flow.startProviderFreshness(row, row)
        flow.resolveLetterboxd = Mock(return_value="https://letterboxd.com/film/example/?secret=do-not-store")
        flow.requestGet = Mock(return_value=response(b'<meta name="twitter:data2" content="0 out of 5">'))
        flow.updateLetterboxd(row, flow.updating_existing_values(row), 101)
        state = row["provider_freshness"]["letterboxd"]
        self.assertEqual(row["lbRating"], 0)
        self.assertEqual(state["fields"]["lbVotes"]["state"], "unverified")
        self.assertNotIn("secret", json.dumps(state))
        flow.resolveLetterboxd = Mock(return_value=None)
        flow._request_local.letterboxd_failure = ("blocked", "http_403")
        flow.updateLetterboxd(row, flow.updating_existing_values(row), 101)
        self.assertEqual(state["outcome"], "blocked")
        self.assertIn("last_success_at", state)

    def test_tmdb_consumers_share_original_observation_without_new_requests(self):
        first, second = self.flow(), self.flow(ComingSoonsUpdate)
        second._request_context = first._request_context
        second._request_lock = first._request_lock
        second._tmdb_cache = first._tmdb_cache
        second._owns_request_context = False
        first.requestGet = Mock(return_value=response({"id": 101, "title": "Fuzzy resolved title", "runtime": 120}))
        data = first.tmdbGet("movie/101", TMDB_MOVIE_DETAILS_PARAMS)
        cached = second.tmdbGet("movie/101", TMDB_MOVIE_DETAILS_PARAMS)
        targets = []
        for flow, payload in ((first, data), (second, cached)):
            target = {"tmdb_id": 101, "english_title": payload["title"], "runtime": payload["runtime"]}
            flow.startProviderFreshness({}, target)
            flow.recordTmdbFreshness(target, payload, 101)
            targets.append(target["provider_freshness"]["tmdb"])
        self.assertEqual(targets[0]["checked_at"], targets[1]["checked_at"])
        self.assertEqual(targets[0]["source"], targets[1]["source"])
        first.requestGet.assert_called_once()
        self.assertNotIn("fixture-secret", json.dumps(targets))

    def test_coming_soon_cached_original_year_survives_repeated_updates(self):
        for year, original_date in ((1987, "1987-03-06"), (2021, "2021-09-15"), (2027, "2027-01-01")):
            with self.subTest(year=year):
                flow = self.flow(ComingSoonsUpdate)
                row = {**self.row(), "release_date": "2026-12-08", "solo_update": False}
                payload = {"id": 101, "title": "Original title", "release_date": original_date}
                flow.tmdbForUpdate = Mock(return_value=payload)
                key = ("movie/101", tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())))
                flow._request_context.tmdb_observations[key] = {
                    "outcome": "cached", "reason": "archived_tmdb_details",
                    "source": {"fetched_at": "2026-11-10T00:00:00+00:00"},
                }
                with patch("backend.dataflow.comingsoons.ComingSoonsUpdate.resolve_tmdb_artwork"):
                    updated = flow.process_row(row)
                    repeated = flow.process_row(updated)
                self.assertEqual(updated["release_year"], year)
                self.assertEqual(repeated["release_year"], year)
                self.assertEqual(repeated["release_date"], row["release_date"])
                self.assertEqual(row["release_year"], 2026)
                provenance = repeated["provider_freshness"]["tmdb"]["fields"]["release_year"]
                self.assertEqual(provenance["state"], "cached")
                self.assertEqual(provenance["observed_at"], "2026-11-10T00:00:00+00:00")

    def test_coming_soon_missing_or_invalid_original_date_retains_year_without_inventing_provenance(self):
        for solo in (False, True):
            for release_date in (None, "", "2026-invalid"):
                with self.subTest(solo=solo, release_date=release_date):
                    flow = self.flow(ComingSoonsUpdate, solo=solo)
                    row = {**self.row(), "release_year": 1987, "release_date": "2026-12-08"}
                    payload = {"id": 101, "release_date": release_date}
                    flow.tmdbForUpdate = Mock(return_value=payload)
                    key = ("movie/101", tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())))
                    flow._request_context.tmdb_observations[key] = observation("success", "usable_fields")
                    with patch("backend.dataflow.comingsoons.ComingSoonsUpdate.resolve_tmdb_artwork"):
                        result = flow.process_row(row)
                    self.assertEqual(result["release_year"], None if solo else 1987)
                    self.assertEqual(result["release_date"], "2026-12-08")
                    provenance = result["provider_freshness"]["tmdb"]["fields"]["release_year"]
                    self.assertNotEqual(provenance["state"], "refreshed")

    def test_solo_clears_values_without_relabelling_them_fresh(self):
        for cls in (NowPlayingsUpdate, CinemathequesUpdate):
            flow = self.flow(cls, solo=True)
            original = self.row()
            old_event = observation("success", "usable_fields", {"imdb_id": "tt101"}, "2020-01-01T00:00:00+00:00")
            old_event["checked_at"] = "2020-01-01T00:00:01+00:00"
            flow.startProviderFreshness(original, original)
            flow.recordProviderFreshness(original, "imdb", old_event, ("imdbRating", "imdbVotes"))
            flow.tmdbForUpdate = Mock(return_value={})
            flow.resolveLetterboxd = Mock(return_value=None)
            flow.requestGet = Mock(side_effect=DataflowRequestError("down", status=403))
            flow._imdb_observation = observation("failed", "request_failed")
            result = flow.process_row(original)
            self.assertFalse(result["solo_update"])
            self.assertIsNone(result["imdbRating"])
            state = result["provider_freshness"]["imdb"]
            self.assertEqual(state["fields"]["imdbRating"]["state"], "cleared")
            self.assertEqual(state["last_success_at"], old_event["checked_at"])
            self.assertEqual(original["imdbRating"], 8.0)

    def test_imdb_dataset_304_missing_id_and_storage_failure_are_distinct(self):
        client = Client()
        self.addCleanup(client.closeDataflowRequests)
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        client.IMDB_CACHE_DIR = Path(directory.name)
        data = gzip.compress(b'tconst\taverageRating\tnumVotes\ntt101\t0.0\t0\n')
        client.requestGet = Mock(side_effect=[response(data, headers={"ETag": "v1"}), response(b'', 304)])
        rows = [{"imdb_id": "tt101"}]
        self.assertEqual(client.loadImdbRatings(rows), {"tt101": {"rating": 0.0, "votes": 0}})
        downloaded = deepcopy(client._imdb_observation)
        self.assertEqual(client.loadImdbRatings(rows), {"tt101": {"rating": 0.0, "votes": 0}})
        checked = client._imdb_observation
        self.assertEqual(checked["source"]["http_status"], 304)
        self.assertEqual(checked["source"]["retrieved_at"], downloaded["source"]["retrieved_at"])
        self.assertEqual(checked["source"]["dataset_sha256"], downloaded["source"]["dataset_sha256"])
        flow, row = self.flow(), self.row()
        flow.startProviderFreshness(row, row)
        flow._imdb_observation = checked
        flow.recordImdbFreshness(row, "ttMissing", None)
        self.assertEqual(row["provider_freshness"]["imdb"]["outcome"], "no_listing")
        with patch.object(client, "imdbRatingsPath", side_effect=PermissionError("private path")):
            self.assertEqual(client.loadImdbRatings(rows), {})
        flow._imdb_observation = client._imdb_observation
        flow.recordImdbFreshness(row, "tt101", None)
        self.assertEqual(row["provider_freshness"]["imdb"]["outcome"], "failed")
        self.assertNotIn("private path", json.dumps(row))

    def test_normal_provider_failure_retains_values_and_unexpected_row_errors_still_skip_normally(self):
        flow, original = self.flow(), self.row()
        flow.tmdbForUpdate = Mock(return_value={})
        flow.resolveLetterboxd = Mock(return_value=None)
        flow.requestGet = Mock(side_effect=DataflowRequestError("down", status=403))
        flow._imdb_observation = observation("failed", "request_failed")
        result = flow.process_row(original)
        for field in ("imdbRating", "imdbVotes", "rtCriticRating", "lbRating", "english_title"):
            self.assertEqual(result[field], original[field])
        self.assertEqual(result["provider_freshness"]["imdb"]["fields"]["imdbRating"]["state"], "unverified")
        flow.beginSharedUpdate = Mock(return_value=[original, {**original, "tmdb_id": 102}])
        flow.prepareUpdateTmdb = Mock()
        flow.loadImdbRatings = Mock(return_value={})
        flow.process_row = Mock(side_effect=[ValueError("unexpected row parse error"), result])
        flow.finishSharedUpdate = Mock()
        flow.logic()  # Existing per-row policy remains successful with one skipped row.
        flow.finishSharedUpdate.assert_called_once_with(2, [result])
        self.assertNotIn("provider_freshness", original)

    def test_missing_identity_never_invents_an_attempt_and_corrupt_imdb_is_not_absence(self):
        flow = self.flow()
        flow.tmdbForUpdate = Mock(side_effect=AssertionError("must not contact TMDb"))
        result = flow.process_row({**self.row(), "tmdb_id": 0})
        self.assertTrue(all(state["outcome"] == "not_attempted" for state in result["provider_freshness"].values()))
        self.assertTrue(all("attempted_at" not in state for state in result["provider_freshness"].values()))
        client = Client()
        self.addCleanup(client.closeDataflowRequests)
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        client.IMDB_CACHE_DIR = Path(directory.name)
        client.requestGet = Mock(return_value=response(b'broken gzip'))
        with patch("backend.dataflow.utils.ImdbRatings.time.sleep"):
            self.assertEqual(client.loadImdbRatings([{"imdb_id": "tt1"}]), {})
        self.assertEqual(client._imdb_observation["outcome"], "parse_error")
        self.assertNotEqual(client._imdb_observation["reason"], "absent_from_dataset")

    def test_mapping_upsert_uses_cached_enrichment_and_keeps_other_provider_history(self):
        from dataflow_database import DB
        flow, original = self.flow(), self.row()
        flow.startProviderFreshness(original, original)
        old_event = observation("success", "usable_fields", {"imdb_id": "tt101"})
        old_event["checked_at"] = "2020-01-01T00:00:00+00:00"
        flow.recordProviderFreshness(original, "imdb", old_event, ("imdbRating", "imdbVotes"))
        flow.supabase = DB({"finalMovies": [original]})
        flow.requestGet = Mock(return_value=response({"id": 101, "title": "Fuzzy resolved title"}))
        flow.tmdbGet("movie/101", TMDB_MOVIE_DETAILS_PARAMS)
        flow.updates = [{"tmdb_id": 101, "english_title": "Fuzzy resolved title"}]
        flow.upsertUpdates("finalMovies", refresh=False)
        published = flow.supabase.tables["finalMovies"][0]
        self.assertEqual(published["provider_freshness"]["tmdb"]["fields"]["english_title"]["state"], "refreshed")
        self.assertEqual(published["provider_freshness"]["imdb"]["last_success_at"], old_event["checked_at"])
        self.assertEqual(published["imdbRating"], 8.0)
        flow.requestGet.assert_called_once()
