from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from unittest import TestCase, main
from unittest.mock import Mock, patch
import gzip, json, requests, time

from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
from backend.dataflow.utils.DataflowRequests import DataflowRequestError, DataflowRequests
from backend.dataflow.utils.ImdbRatings import ImdbRatings


def response(data, status=200, headers=None):
    result = requests.Response()
    result.status_code = status
    result._content = data if isinstance(data, bytes) else json.dumps(data).encode()
    result._content_consumed = True
    result.headers.update(headers or {})
    return result


class Client(DataflowRequests, DataflowHelpers, ImdbRatings):
    REQUESTS_PER_SECOND = 1000000
    TMDB_API_KEY = "test-key"
    requests_headers = {}

    def __init__(self):
        self.initDataflowRequests()
        self.notes = []

    def trace_note(self, note):
        self.notes.append(note)


class RequestTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.addCleanup(self.client.closeDataflowRequests)

    def test_candidate_completion_order_cannot_change_matching_order(self):
        active, peak, lock = 0, 0, Lock()

        def fetch(path, *args, **kwargs):
            nonlocal active, peak
            movie_id = int(path.split("/")[-1])
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.04 if movie_id == 1 else 0.005)
            with lock:
                active -= 1
            return {"id": movie_id}

        self.client.tmdbGet = fetch
        self.assertEqual(list(self.client.fetchTmdbDetails(range(1, 13))), list(range(1, 13)))
        self.assertGreater(peak, 1)
        self.assertLessEqual(peak, 5)

    def test_concurrent_identical_requests_share_one_success_and_return_copies(self):
        session = Mock()

        def get(*args, **kwargs):
            time.sleep(0.02)
            return response({"id": 1, "genres": [{"name": "Drama"}]})

        session.get.side_effect = get
        self.client.requestSession = lambda url: session
        with ThreadPoolExecutor(max_workers=10) as pool:
            values = list(pool.map(lambda _: self.client.tmdbGet("movie/1"), range(20)))
        self.assertEqual(session.get.call_count, 1)
        values[0]["genres"][0]["name"] = "Changed"
        self.assertEqual(values[1]["genres"][0]["name"], "Drama")

    def test_failures_are_not_cached_and_do_not_leak_api_keys(self):
        session = Mock()
        session.get.side_effect = [requests.ReadTimeout("url?api_key=secret")] * 3 + [response({"id": 1})]
        self.client.requestSession = lambda url: session
        with patch("backend.dataflow.utils.DataflowRequests.time.sleep"):
            with self.assertRaises(DataflowRequestError) as failure:
                self.client.tmdbGet("movie/1")
        self.assertNotIn("secret", str(failure.exception))
        self.assertEqual(self.client.tmdbGet("movie/1"), {"id": 1})
        self.assertEqual(session.get.call_count, 4)

    def test_authentication_failure_is_not_retried(self):
        for status in (400, 401, 403):
            with self.subTest(status=status):
                session = Mock()
                session.get.return_value = response({}, status)
                self.client.requestSession = lambda url: session
                with self.assertRaises(DataflowRequestError):
                    self.client.tmdbGet("movie/1")
                self.assertEqual(session.get.call_count, 1)

    def test_retry_after_is_respected_and_excessive_delay_does_not_retry_early(self):
        for delay, calls in (("2", 2), ("120", 1)):
            with self.subTest(delay=delay):
                session = Mock()
                session.get.side_effect = [response({}, 429, {"Retry-After": delay}), response({"id": 1})]
                self.client.requestSession = lambda url: session
                with patch("backend.dataflow.utils.DataflowRequests.time.sleep") as sleep:
                    if calls == 1:
                        with self.assertRaises(DataflowRequestError):
                            self.client.tmdbGet("movie/1")
                    else:
                        self.client.tmdbGet("movie/1")
                        self.assertIn(2, [call.args[0] for call in sleep.call_args_list])
                self.assertEqual(session.get.call_count, calls)
                self.client._tmdb_cache.clear()

    def test_malformed_payload_and_wrong_movie_id_are_retried_before_use(self):
        for data in ([], {"id": 2}, b"invalid json"):
            with self.subTest(data=data):
                session = Mock()
                session.get.side_effect = [response(data), response({"id": 1})]
                self.client.requestSession = lambda url: session
                with patch("backend.dataflow.utils.DataflowRequests.time.sleep"):
                    self.assertEqual(self.client.tmdbGet("movie/1"), {"id": 1})
                self.assertEqual(session.get.call_count, 2)
                self.client._tmdb_cache.clear()

    def test_missing_candidate_is_not_a_cached_success_or_required_enrichment(self):
        session = Mock()
        session.get.return_value = response({}, 404)
        self.client.requestSession = lambda url: session
        self.assertEqual(self.client.tmdbGet("movie/1", allow_missing=True), {})
        with self.assertRaises(DataflowRequestError):
            self.client.tmdbGet("movie/1")
        self.assertEqual(session.get.call_count, 2)

    def test_letterboxd_direct_success_needs_no_homepage_or_retry_sleep(self):
        self.client.requestGet = Mock(return_value=response({}, 302, {"Location": "/film/example/"}))
        with patch("backend.dataflow.utils.DataflowRequests.time.sleep") as sleep:
            self.assertEqual(self.client.resolveLetterboxd(1), "https://letterboxd.com/film/example/")
        self.assertEqual(self.client.requestGet.call_count, 1)
        sleep.assert_not_called()

    def test_letterboxd_tenth_legacy_bootstrap_still_succeeds(self):
        homes = 0

        def get(url, **kwargs):
            nonlocal homes
            if url == "https://letterboxd.com/":
                homes += 1
                return response(b"Forbidden", 403)
            if homes < 10:
                return response(b"Just a moment", 403)
            return response({}, 302, {"Location": "/film/example/"})

        self.client.requestGet = get
        with patch("backend.dataflow.utils.DataflowRequests.time.sleep"):
            self.assertEqual(self.client.resolveLetterboxd(1), "https://letterboxd.com/film/example/")
        self.assertEqual(homes, 10)

    def test_all_concurrent_provider_rows_share_one_pool(self):
        self.client.updateLetterboxd = lambda *args: None
        self.client.updateRottenTomatoes = lambda *args: None
        with patch("backend.dataflow.utils.DataflowRequests.ThreadPoolExecutor", wraps=ThreadPoolExecutor) as executor:
            with ThreadPoolExecutor(max_workers=5) as rows:
                list(rows.map(lambda _: self.client.updateProviders({}, {}, 1), range(20)))
            self.assertEqual(executor.call_count, 1)

    def test_resource_cleanup_closes_sessions_and_executors(self):
        session = self.client.requestSession("https://example.com")
        self.client.tmdbExecutor().submit(lambda: None).result()
        with patch.object(session, "close") as close:
            self.client.closeDataflowRequests()
            close.assert_called_once()
        self.assertIsNone(self.client._tmdb_executor)
        self.assertEqual(self.client._request_sessions, [])


class ImdbTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.addCleanup(self.client.closeDataflowRequests)
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client.IMDB_CACHE_DIR = Path(self.directory.name)
        self.dataset = gzip.compress(b"tconst\taverageRating\tnumVotes\ntt1\t7.1\t100\ntt2\t8.2\t200\n")

    def test_new_tmdb_imdb_ids_are_included_before_lookup(self):
        self.client._update_tmdb = {1: {"external_ids": {"imdb_id": "tt2"}}}
        self.client.requestGet = Mock(return_value=response(self.dataset, headers={"ETag": "version1"}))
        result = self.client.loadImdbRatings([{"tmdb_id": 1, "imdb_id": ""}])
        self.assertEqual(result, {"tt2": {"rating": 8.2, "votes": 200}})

    def test_conditional_revalidation_reuses_only_the_confirmed_version(self):
        self.client.requestGet = Mock(side_effect=[response(self.dataset, headers={"ETag": "version1"}), response(b"", 304)])
        rows = [{"imdb_id": "tt1"}]
        self.assertEqual(self.client.loadImdbRatings(rows), self.client.loadImdbRatings(rows))
        self.assertEqual(self.client.requestGet.call_args.kwargs["headers"], {"If-None-Match": "version1"})
        self.assertEqual(len(list(Path(self.directory.name).glob("*.tsv.gz"))), 1)

    def test_corrupt_gzip_never_replaces_valid_cached_metadata(self):
        self.client.requestGet = Mock(return_value=response(self.dataset, headers={"ETag": "version1"}))
        old = self.client.loadImdbRatings([{"imdb_id": "tt1"}])
        metadata_path = Path(self.directory.name) / "metadata.json"
        metadata = metadata_path.read_bytes()
        self.client.requestGet = Mock(return_value=response(b"broken gzip", headers={"ETag": "version2"}))
        with patch("backend.dataflow.utils.ImdbRatings.time.sleep"):
            self.assertEqual(self.client.loadImdbRatings([{"imdb_id": "tt1"}]), {})
        self.assertEqual(metadata_path.read_bytes(), metadata)
        self.assertEqual(old["tt1"]["rating"], 7.1)

    def test_truncated_stream_retries_whole_download(self):
        broken = response(b"")
        broken.iter_content = Mock(side_effect=requests.ConnectionError("truncated stream"))
        self.client.requestGet = Mock(side_effect=[broken, response(self.dataset)])
        with patch("backend.dataflow.utils.ImdbRatings.time.sleep"):
            self.assertEqual(self.client.loadImdbRatings([{"imdb_id": "tt1"}])["tt1"]["votes"], 100)
        self.assertEqual(self.client.requestGet.call_count, 2)

    def test_corrupt_revalidated_cache_is_downloaded_again(self):
        self.client.requestGet = Mock(return_value=response(self.dataset, headers={"ETag": "version1"}))
        self.client.loadImdbRatings([{"imdb_id": "tt1"}])
        cached = next(Path(self.directory.name).glob("*.tsv.gz"))
        cached.write_bytes(b"corrupt")
        self.client.requestGet = Mock(side_effect=[response(b"", 304), response(self.dataset, headers={"ETag": "version1"})])
        with patch("backend.dataflow.utils.ImdbRatings.time.sleep"):
            result = self.client.loadImdbRatings([{"imdb_id": "tt1"}])
        self.assertEqual(result["tt1"]["rating"], 7.1)
        self.assertEqual(self.client.requestGet.call_count, 2)

    def test_bad_cache_metadata_is_repaired_by_download(self):
        (Path(self.directory.name) / "metadata.json").write_text("[]")
        self.client.requestGet = Mock(return_value=response(self.dataset))
        self.assertEqual(self.client.loadImdbRatings([{"imdb_id": "tt1"}])["tt1"]["rating"], 7.1)


if __name__ == "__main__":
    main()
