from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from unittest import TestCase
from unittest.mock import Mock, patch
import json
import requests
import time

from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext, DataflowRequests
from backend.dataflow.utils.ProviderFreshness import ProviderFreshness
from backend.dataflow.utils.TmdbMovieDetailsCache import (
    TMDB_DETAILS_CACHE_FORMAT_VERSION,
    TMDB_DETAILS_RESPONSE_PROFILE,
    TmdbMovieDetailsCache,
    archive_cutoff_year,
    is_archived_release,
    validate_movie_details,
)


def movie_details(tmdb_id=2468, release_date="2001-09-08"):
    return {
        "id": tmdb_id,
        "title": "Example Movie",
        "original_title": "Exemple de film",
        "release_date": release_date,
        "runtime": 108,
        "popularity": 10.5,
        "poster_path": "/poster.jpg",
        "backdrop_path": "/backdrop.jpg",
        "vote_average": 7.5,
        "vote_count": 500,
        "genres": [{"id": 18, "name": "Drama"}],
        "external_ids": {"imdb_id": "tt2468"},
        "credits": {"crew": [{"name": "Director Name", "job": "Director"}]},
        "videos": {"results": []},
    }


def http_response(data, status=200):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps(data).encode("utf-8")
    response._content_consumed = True
    return response


class MemoryMovieCache:
    def __init__(self, rows=None, *, read_error=None, write_error=None):
        self.rows = deepcopy(rows or {})
        self.read_error = read_error
        self.write_error = write_error
        self.read_calls = []
        self.write_calls = []
        self.lock = Lock()

    def read_many(self, ids):
        with self.lock:
            self.read_calls.append(list(ids))
            if self.read_error:
                raise self.read_error
            return {int(tmdb_id): deepcopy(self.rows[int(tmdb_id)]) for tmdb_id in ids if int(tmdb_id) in self.rows}

    def write(self, tmdb_id, payload, *, fetched_at=None):
        with self.lock:
            self.write_calls.append(int(tmdb_id))
            if self.write_error:
                raise self.write_error
            row = {
                "payload": deepcopy(payload),
                "original_release_date": payload.get("release_date") or None,
                "fetched_at": fetched_at or "2026-01-01T00:00:00+00:00",
                "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
                "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
            }
            self.rows[int(tmdb_id)] = deepcopy(row)
            return row


class CacheClient(DataflowRequests, ProviderFreshness, DataflowHelpers):
    REQUESTS_PER_SECOND = 1000000
    TMDB_API_KEY = "cache-test-key"
    MAIN_TABLE_NAME = "finalMovies"
    requests_headers = {}

    def __init__(self, cache=None):
        self.initDataflowRequests()
        self.notes = []
        if cache is not None:
            self._request_context.tmdb_movie_details_cache = cache

    def trace_note(self, note):
        self.notes.append(note)


def configure_network(client, payload):
    session = Mock()
    session.get.return_value = http_response(payload)
    client.requestSession = lambda _url: session
    return session


def row_from_payload(payload):
    return {
        "tmdb_id": payload["id"],
        "english_title": payload["title"],
        "runtime": payload["runtime"],
        "popularity": payload["popularity"],
        "imdb_id": payload["external_ids"].get("imdb_id"),
        "en_poster": payload["poster_path"],
        "backdrop": payload["backdrop_path"],
        "tmdbRating": payload["vote_average"],
        "tmdbVotes": payload["vote_count"],
        "genres": ["Drama"],
        "en_trailer": "",
    }


class ArchiveEligibilityTests(TestCase):
    def test_archive_boundary_uses_israel_calendar_year(self):
        just_entered_2026_israel = datetime(2025, 12, 31, 22, 30, tzinfo=timezone.utc)
        still_2025_israel = datetime(2025, 12, 31, 20, 30, tzinfo=timezone.utc)
        self.assertEqual(archive_cutoff_year(just_entered_2026_israel), 2023)
        self.assertEqual(archive_cutoff_year(still_2025_israel), 2022)
        self.assertTrue(is_archived_release("2023-01-01", now=just_entered_2026_israel))
        self.assertFalse(is_archived_release("2024-12-31", now=just_entered_2026_israel))
        self.assertFalse(is_archived_release("2023-01-01", now=still_2025_israel))

    def test_cache_requires_complete_matching_canonical_response(self):
        valid = movie_details()
        self.assertEqual(validate_movie_details(valid, valid["id"]), valid)
        for malformed in (
            {**valid, "id": valid["id"] + 1},
            {key: value for key, value in valid.items() if key != "original_title"},
            {**valid, "release_date": "not-a-date"},
            {key: value for key, value in valid.items() if key != "credits"},
            {**valid, "videos": {}},
            {**valid, "credits": {"crew": [None]}},
        ):
            with self.subTest(malformed=malformed):
                self.assertIsNone(validate_movie_details(malformed, valid["id"]))


class PersistentMovieCacheTests(TestCase):
    def client(self, cache=None):
        client = CacheClient(cache)
        self.addCleanup(client.closeDataflowRequests)
        return client

    def test_cold_archived_response_is_saved_then_warm_response_uses_zero_network_calls_across_runs(self):
        persistent = MemoryMovieCache()
        cold = self.client(persistent)
        cold_http = configure_network(cold, movie_details())
        cold_value = cold.tmdbMovieDetails(2468)
        self.assertEqual(cold_value["id"], 2468)
        cold_http.get.assert_called_once()
        self.assertEqual(persistent.write_calls, [2468])

        warm = self.client(persistent)
        warm_http = configure_network(warm, movie_details())
        warm_value = warm.tmdbMovieDetails(2468)
        warm_http.get.assert_not_called()
        self.assertEqual(warm_value, cold_value)
        self.assertEqual(warm._tmdb_metrics["tmdb_persistent_detail_hits"], 1)
        self.assertEqual(warm._tmdb_metrics["tmdb_movie_detail_http_requests"], 0)
        self.assertEqual(warm._request_context.tmdb_observations[("movie/2468", tuple(sorted({"append_to_response": "external_ids,credits,videos", "language": "en-US"}.items())))]["outcome"], "cached")

    def test_younger_unknown_date_and_rerelease_dates_do_not_cause_archive_reuse(self):
        for release_date in ("2024-05-01", None):
            with self.subTest(release_date=release_date):
                persistent = MemoryMovieCache()
                payload = movie_details(release_date=release_date)
                first = self.client(persistent)
                first_http = configure_network(first, payload)
                first.tmdbMovieDetails(2468)
                first_http.get.assert_called_once()
                second = self.client(persistent)
                second_http = configure_network(second, payload)
                second.tmdbMovieDetails(2468)
                second_http.get.assert_called_once()

        # A local cinema screening date cannot make an old TMDb release young.
        old_payload = movie_details(release_date="2001-09-08")
        persistent = MemoryMovieCache({2468: {
            "payload": old_payload,
            "original_release_date": old_payload["release_date"],
            "fetched_at": "2020-01-01T00:00:00+00:00",
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }})
        reader = self.client(persistent)
        http = configure_network(reader, old_payload)
        self.assertEqual(reader.tmdbMovieDetails(2468), old_payload)
        http.get.assert_not_called()

    def test_incomplete_appended_response_is_never_persisted_or_reused(self):
        persistent = MemoryMovieCache()
        malformed = movie_details()
        malformed.pop("credits")
        first = self.client(persistent)
        first_http = configure_network(first, malformed)
        first.tmdbMovieDetails(2468)
        first_http.get.assert_called_once()
        self.assertFalse(persistent.rows)
        self.assertEqual(first._tmdb_metrics["tmdb_cache_write_failures"], 1)
        self.assertTrue(any("tmdb_cache_write_failed" in note for note in first.notes))

        second = self.client(persistent)
        second_http = configure_network(second, malformed)
        second.tmdbMovieDetails(2468)
        second_http.get.assert_called_once()

    def test_missing_movie_is_not_archived_and_is_looked_up_again_next_run(self):
        persistent = MemoryMovieCache()
        for _ in range(2):
            client = self.client(persistent)
            session = Mock()
            session.get.return_value = http_response({}, status=404)
            client.requestSession = lambda _url: session
            self.assertEqual(client.tmdbMovieDetails(2468, allow_missing=True), {})
            session.get.assert_called_once()
        self.assertFalse(persistent.rows)

    def test_cache_read_failure_does_not_prevent_a_later_cache_write(self):
        persistent = MemoryMovieCache(read_error=RuntimeError("read unavailable"))
        client = self.client(persistent)
        http = configure_network(client, movie_details())
        client.tmdbMovieDetails(2468)
        http.get.assert_called_once()
        self.assertIn(2468, persistent.rows)
        self.assertEqual(client._tmdb_metrics["tmdb_cache_read_failures"], 1)

    def test_cache_read_or_write_failure_falls_back_to_live_request_with_visible_diagnostic(self):
        for cache in (MemoryMovieCache(read_error=RuntimeError("offline")), MemoryMovieCache(write_error=RuntimeError("offline"))):
            with self.subTest(cache=cache):
                client = self.client(cache)
                http = configure_network(client, movie_details())
                client.tmdbMovieDetails(2468)
                http.get.assert_called_once()
                self.assertTrue(any("tmdb_cache_" in note and "failed" in note for note in client.notes))

    def test_candidate_fetch_and_update_share_archived_cache_and_preserve_cached_freshness(self):
        payload = movie_details()
        persistent = MemoryMovieCache({2468: {
            "payload": payload,
            "original_release_date": payload["release_date"],
            "fetched_at": "2020-05-04T03:02:01+00:00",
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }})
        client = self.client(persistent)
        http = configure_network(client, payload)
        self.assertEqual(dict(client.fetchTmdbDetails([2468])), {2468: payload})
        client.prepareUpdateTmdb([{"tmdb_id": 2468}])
        self.assertEqual(client.tmdbForUpdate(2468), payload)
        http.get.assert_not_called()
        self.assertEqual(len(persistent.read_calls), 1)

        target = row_from_payload(payload)
        client.startProviderFreshness({}, target)
        client.recordTmdbFreshness(target, payload, 2468)
        tmdb = target["provider_freshness"]["tmdb"]
        self.assertNotIn("last_checked_at", tmdb)
        self.assertNotIn("last_success_at", tmdb)
        self.assertEqual(tmdb["fields"]["english_title"]["state"], "cached")
        self.assertEqual(tmdb["fields"]["english_title"]["observed_at"], "2020-05-04T03:02:01+00:00")

    def test_same_run_cold_fetch_reuse_keeps_its_live_observation_and_is_not_a_persistent_hit(self):
        persistent = MemoryMovieCache()
        client = self.client(persistent)
        http = configure_network(client, movie_details())
        self.assertEqual(dict(client.fetchTmdbDetails([2468]))[2468]["id"], 2468)
        original_event = client._request_context.tmdb_observations[(
            "movie/2468", tuple(sorted({"append_to_response": "external_ids,credits,videos", "language": "en-US"}.items()))
        )]
        client.prepareUpdateTmdb([{"tmdb_id": 2468}])
        self.assertEqual(client.tmdbForUpdate(2468)["id"], 2468)
        self.assertEqual(client._request_context.tmdb_observations[(
            "movie/2468", tuple(sorted({"append_to_response": "external_ids,credits,videos", "language": "en-US"}.items()))
        )]["outcome"], "success")
        self.assertEqual(client._tmdb_metrics["tmdb_persistent_detail_hits"], 0)
        self.assertEqual(client._tmdb_metrics["tmdb_run_cache_detail_hits"], 1)
        http.get.assert_called_once()

        target = row_from_payload(movie_details())
        client.startProviderFreshness({}, target)
        client.recordTmdbFreshness(target, movie_details(), 2468)
        self.assertEqual(target["provider_freshness"]["tmdb"]["fields"]["english_title"]["state"], "refreshed")
        self.assertEqual(target["provider_freshness"]["tmdb"]["last_checked_at"], original_event["checked_at"])

    def test_parallel_cold_requests_share_network_call_and_detail_cache_batch_read(self):
        persistent = MemoryMovieCache()
        client = self.client(persistent)
        session = Mock()
        session.get.side_effect = lambda *_args, **_kwargs: (time.sleep(0.02), http_response(movie_details()))[1]
        client.requestSession = lambda _url: session
        with ThreadPoolExecutor(max_workers=6) as pool:
            values = list(pool.map(lambda _: client.tmdbMovieDetails(2468), range(6)))
        self.assertTrue(all(value["id"] == 2468 for value in values))
        self.assertEqual(session.get.call_count, 1)
        self.assertEqual(len(persistent.read_calls), 1)

    def test_explicit_force_refresh_bypasses_archived_cache(self):
        payload = movie_details()
        persistent = MemoryMovieCache({2468: {
            "payload": payload,
            "original_release_date": payload["release_date"],
            "fetched_at": "2020-05-04T03:02:01+00:00",
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }})
        client = self.client(persistent)
        refreshed = {**payload, "popularity": 99}
        http = configure_network(client, refreshed)
        self.assertEqual(client.tmdbMovieDetails(2468, force_refresh=True)["popularity"], 99)
        http.get.assert_called_once()
        self.assertEqual(persistent.rows[2468]["payload"]["popularity"], 99)


class CacheAdapterTests(TestCase):
    class Query:
        def __init__(self, table, rows, calls):
            self.table_name = table
            self.rows = rows
            self.calls = calls

        def select(self, columns):
            self.calls.append(("select", self.table_name, columns))
            return self

        def in_(self, column, values):
            self.calls.append(("in", column, list(values)))
            self.values = set(values)
            return self

        def upsert(self, row, on_conflict):
            self.calls.append(("upsert", self.table_name, row, on_conflict))
            self.upsert_row = row
            return self

        def execute(self):
            if hasattr(self, "upsert_row"):
                return Mock(data=[self.upsert_row])
            return Mock(data=[row for row in self.rows if row["tmdb_id"] in self.values])

    class Client:
        def __init__(self, rows):
            self.rows = rows
            self.calls = []

        def table(self, table_name):
            return CacheAdapterTests.Query(table_name, self.rows, self.calls)

    def test_adapter_batches_reads_validates_profile_and_upserts_backend_fields(self):
        payload = movie_details()
        row = {
            "tmdb_id": 2468,
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "payload": payload,
            "original_release_date": payload["release_date"],
            "fetched_at": "2026-01-02T03:04:05+00:00",
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }
        client = self.Client([row, {**row, "tmdb_id": 12, "response_profile": "old"}])
        cache = TmdbMovieDetailsCache(client)
        self.assertEqual(cache.read_many([2468, 12]), {2468: {
            "payload": payload,
            "original_release_date": payload["release_date"],
            "fetched_at": "2026-01-02T03:04:05+00:00",
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }})
        saved = cache.write(2468, payload, fetched_at="2026-01-02T03:04:05+00:00")
        self.assertEqual(saved["tmdb_id"], 2468)
        self.assertIn(("upsert", "tmdb_movie_details_cache", saved, "tmdb_id"), client.calls)


class CacheRefreshCommandTests(TestCase):
    def test_refresh_command_forces_the_requested_id_and_reports_only_after_successful_write(self):
        from backend.dataflow.utils import refresh_tmdb_movie_cache as command

        payload = movie_details()
        fake_client = Mock()
        fake_client.tmdbMovieDetails.return_value = payload
        fake_client._tmdb_metrics = {"tmdb_cache_write_failures": 0}
        fake_client._tmdb_movie_cache_rows = {2468: {
            "original_release_date": payload["release_date"],
            "fetched_at": "2026-01-01T00:00:00+00:00",
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }}
        with (
            patch.dict("os.environ", {"TMDB_API_KEY": "key"}, clear=True),
            patch.object(command, "load_dotenv"),
            patch.object(command, "resolve_target_environment", return_value={}),
            patch.object(command, "_CacheRefreshClient", return_value=fake_client),
        ):
            self.assertEqual(command.main(["--target", "development", "--tmdb-id", "2468"]), 0)
        fake_client.tmdbMovieDetails.assert_called_once_with(2468, allow_missing=False, force_refresh=True)
        fake_client.closeDataflowRequests.assert_called_once()


if __name__ == "__main__":
    import unittest
    unittest.main()
