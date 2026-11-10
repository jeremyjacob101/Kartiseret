from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import RLock, local
from urllib.parse import urlsplit
import copy, requests, time
import uuid
from backend.dataflow.utils.ProviderFreshness import utc_now, observation, failure
from backend.dataflow.utils.TmdbMovieDetailsCache import (
    TMDB_DETAILS_CACHE_FORMAT_VERSION,
    TMDB_DETAILS_RESPONSE_PROFILE,
    TmdbMovieDetailsCache,
    is_archived_release,
    validate_movie_details,
)


TMDB_MOVIE_DETAILS_PARAMS = {
    "append_to_response": "external_ids,credits,videos",
    "language": "en-US",
}


class DataflowRequestError(RuntimeError):
    def __init__(self, message, status=None, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class DataflowRequestContext:
    """Request state shared by dataflows that participate in one run."""

    def __init__(self, request_workers: int = 5, provider_workers: int = 10, requests_per_second: int = 10):
        self.lock = RLock()
        self.request_next = {}
        self.tmdb_cache = {}
        self.tmdb_observations = {}
        self.tmdb_movie_cache_rows = {}
        self.tmdb_movie_cache_loaded_ids = set()
        self.tmdb_movie_cache_persisted_ids = set()
        self.tmdb_movie_cache_lock = RLock()
        self.tmdb_movie_cache_unavailable = False
        self.tmdb_movie_details_cache = None
        self.tmdb_metrics = {
            "tmdb_search_http_requests": 0,
            "tmdb_movie_detail_http_requests": 0,
            "tmdb_other_http_requests": 0,
            "tmdb_in_memory_hits": 0,
            "tmdb_run_cache_detail_hits": 0,
            "tmdb_persistent_cache_rows_loaded": 0,
            "tmdb_persistent_detail_hits": 0,
            "tmdb_cache_writes": 0,
            "tmdb_cache_read_failures": 0,
            "tmdb_cache_write_failures": 0,
            "tmdb_archived_movie_ids": set(),
        }
        self.tmdb_executor = None
        self.provider_executor = None
        self.request_workers = request_workers
        self.provider_workers = provider_workers
        self.requests_per_second = requests_per_second
        self.selected_mapping_tables: frozenset[str] = frozenset()

    def get_tmdb_executor(self):
        with self.lock:
            if self.tmdb_executor is None:
                self.tmdb_executor = ThreadPoolExecutor(max_workers=self.request_workers)
            return self.tmdb_executor

    def get_provider_executor(self):
        with self.lock:
            if self.provider_executor is None:
                self.provider_executor = ThreadPoolExecutor(max_workers=self.provider_workers)
            return self.provider_executor

    def close(self):
        with self.lock:
            executors = (self.tmdb_executor, self.provider_executor)
            self.tmdb_executor = None
            self.provider_executor = None
            self.tmdb_cache.clear()
            self.tmdb_observations.clear()
            self.tmdb_movie_cache_rows.clear()
            self.tmdb_movie_cache_loaded_ids.clear()
            self.tmdb_movie_cache_persisted_ids.clear()
            self.tmdb_metrics.clear()
            self.request_next.clear()
        for executor in executors:
            if executor is not None:
                executor.shutdown(wait=True)


class DataflowRequests:
    REQUEST_WORKERS = 5
    REQUESTS_PER_SECOND = 10
    LETTERBOXD_MAX_ATTEMPTS = 10

    def initDataflowRequests(self, context: DataflowRequestContext | None = None):
        self._request_local = local()
        self._owns_request_context = context is None
        self._request_context = context or DataflowRequestContext(
            request_workers=self.REQUEST_WORKERS,
            provider_workers=2 * self.REQUEST_WORKERS,
            requests_per_second=self.REQUESTS_PER_SECOND,
        )
        self._request_lock = self._request_context.lock
        self._request_sessions = []
        # Keep these aliases for existing callers and diagnostics.
        self._request_next = self._request_context.request_next
        self._tmdb_cache = self._request_context.tmdb_cache
        self._tmdb_movie_cache_rows = self._request_context.tmdb_movie_cache_rows
        self._tmdb_movie_cache_loaded_ids = self._request_context.tmdb_movie_cache_loaded_ids
        self._tmdb_movie_cache_persisted_ids = self._request_context.tmdb_movie_cache_persisted_ids
        self._tmdb_metrics = self._request_context.tmdb_metrics
        self._tmdb_executor = self._request_context.tmdb_executor
        self._provider_executor = self._request_context.provider_executor
        self._update_tmdb = {}

    def requestSession(self, url):
        host = urlsplit(url).netloc
        if not hasattr(self._request_local, "sessions"):
            self._request_local.sessions = {}
        if host not in self._request_local.sessions:
            session = requests.Session()
            self._request_local.sessions[host] = session
            with self._request_lock:
                self._request_sessions.append(session)
        return self._request_local.sessions[host]

    def resetRequestSession(self, url):
        sessions = getattr(self._request_local, "sessions", {})
        session = sessions.pop(urlsplit(url).netloc, None)
        if session is not None:
            session.close()
            with self._request_lock:
                self._request_sessions.remove(session)

    def retryDelay(self, response, attempt):
        value = response.headers.get("Retry-After") if response is not None else None
        if value:
            try:
                return max(0, float(value))
            except ValueError:
                try:
                    return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
                except (TypeError, ValueError, OverflowError):
                    pass
        return min(0.5 * 2 ** attempt, 4)

    def requestGet(self, url, timeout=10, attempts=3, check_status=True, validate=None, **kwargs):
        host = urlsplit(url).netloc
        deadline = time.monotonic() + max(30, max(timeout) if isinstance(timeout, tuple) else timeout)
        for attempt in range(attempts):
            response = None
            try:
                with self._request_lock:
                    now = time.monotonic()
                    delay = max(0, self._request_next.get(host, now) - now)
                    if delay >= deadline - now:
                        break
                    self._request_next[host] = max(now, self._request_next.get(host, now)) + 1 / self._request_context.requests_per_second
                if delay:
                    time.sleep(delay)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                bounded_timeout = tuple(min(v, remaining) for v in timeout) if isinstance(timeout, tuple) else min(timeout, remaining)
                if host == "api.themoviedb.org":
                    path = urlsplit(url).path
                    metric = "tmdb_search_http_requests" if path.endswith("/search/movie") else "tmdb_movie_detail_http_requests" if "/movie/" in path else "tmdb_other_http_requests"
                    with self._request_lock:
                        self._tmdb_metrics[metric] = self._tmdb_metrics.get(metric, 0) + 1
                response = self.requestSession(url).get(url, timeout=bounded_timeout, **kwargs)
                if check_status and response.status_code in (429, 500, 502, 503, 504):
                    raise requests.RequestException("transient response")
                if check_status and response.status_code >= 400 and response.status_code != 404:
                    status = response.status_code
                    response.close()
                    self.trace_note(f"provider_unavailable | host={host} | status={status}")
                    raise DataflowRequestError(f"{host} returned HTTP {status}", status=status)
                if validate and response.status_code != 404:
                    validate(response.json())
                return response
            except (requests.RequestException, ValueError):
                delay = self.retryDelay(response, attempt)
                if response is not None:
                    response.close()
                if attempt + 1 >= attempts or delay >= deadline - time.monotonic():
                    break
                self.trace_note(f"request_retry | host={host} | attempt={attempt + 1}")
                time.sleep(delay)
        # Never include query strings or the API key in exception artifacts.
        self.trace_note(f"provider_unavailable | host={host} | attempts={attempt + 1}")
        retry_after = self.retryDelay(response, attempt) if response is not None and response.headers.get("Retry-After") else None
        raise DataflowRequestError(f"{host} request failed after bounded retries", status=response.status_code if response is not None else None, retry_after=retry_after)

    def tmdbGet(self, path, params=None, allow_missing=False):
        params = dict(params or {})
        key = (path, tuple(sorted(params.items())))
        with self._request_lock:
            pending = self._tmdb_cache.get(key)
            owner = pending is None
            if owner:
                pending = self._tmdb_cache[key] = Future()
        if not owner:
            with self._request_lock:
                self._tmdb_metrics["tmdb_in_memory_hits"] = self._tmdb_metrics.get("tmdb_in_memory_hits", 0) + 1
            data = pending.result()
            if not data and not allow_missing:
                raise DataflowRequestError(f"TMDB resource missing: {path}")
            return copy.deepcopy(data)

        started = utc_now()
        source = {"tmdb_id": str(path.rsplit("/", 1)[-1]), "request_shape": str(params.get("append_to_response", "")), "observation_id": str(uuid.uuid4())}

        def validate(data):
            if not isinstance(data, dict) or data.get("success") is False:
                raise ValueError("invalid TMDB object")
            if path == "search/movie":
                if not isinstance(data.get("results"), list) or any(not isinstance(row, dict) for row in data["results"]):
                    raise ValueError("invalid TMDB search")
            elif self.clean_int(data.get("id")) != self.clean_int(path.rsplit("/", 1)[-1]):
                raise ValueError("invalid TMDB movie")

        try:
            with self.requestGet(f"https://api.themoviedb.org/3/{path}", params={**params, "api_key": self.TMDB_API_KEY}, validate=validate) as response:
                if response.status_code == 404:
                    if not allow_missing:
                        raise DataflowRequestError(f"TMDB resource missing: {path}")
                    data = {}
                else:
                    data = response.json()
            with self._request_lock:
                self._request_context.tmdb_observations[key] = observation("success" if data else "no_listing", "usable_response" if data else "http_404", source, started)
            if data and path.startswith("movie/") and tuple(sorted(params.items())) == tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())):
                self._saveTmdbMovieDetails(data, key)
            pending.set_result(data)
            if not data:
                with self._request_lock:
                    self._tmdb_cache.pop(key, None)
            return copy.deepcopy(data)
        except BaseException as error:
            # Wake other callers even when the cache owner is interrupted.
            with self._request_lock:
                self._tmdb_cache.pop(key, None)
                outcome, reason = failure(error)
                self._request_context.tmdb_observations[key] = observation(outcome, reason, source, started)
            pending.set_exception(error)
            if path == "search/movie" and hasattr(self, "recordTmdbSearchResponse"):
                self.recordTmdbSearchResponse(params, {})
            elif path.startswith("movie/") and hasattr(self, "recordTmdbDetailFailure"):
                self.recordTmdbDetailFailure(path)
            raise

    def tmdbExecutor(self):
        self._tmdb_executor = self._request_context.get_tmdb_executor()
        return self._tmdb_executor

    def fetchTmdbDetails(self, candidates):
        self._loadTmdbMovieDetailsCache(candidates)

        def fetch(tmdb_id):
            data = self.tmdbMovieDetails(tmdb_id, allow_missing=True)
            return tmdb_id, data

        # map retains candidate order even when later requests finish first.
        return {tmdb_id: data for tmdb_id, data in self.tmdbExecutor().map(fetch, candidates) if data}

    def prepareUpdateTmdb(self, rows):
        ids = list(dict.fromkeys(self.clean_int(row.get("tmdb_id")) for row in rows if self.clean_int(row.get("tmdb_id"))))
        self._loadTmdbMovieDetailsCache(ids)
        self._update_tmdb = dict(zip(ids, self.tmdbExecutor().map(self.tmdbForUpdate, ids)))

    def tmdbForUpdate(self, tmdb_id):
        if tmdb_id in self._update_tmdb:
            return self._update_tmdb[tmdb_id]
        try:
            return self.tmdbMovieDetails(tmdb_id, allow_missing=True)
        except DataflowRequestError:
            self.trace_note(f"provider_unavailable | source=tmdb | tmdb={tmdb_id}")
            return {}

    def _loadTmdbMovieDetailsCache(self, tmdb_ids):
        ids = sorted({int(value) for value in tmdb_ids if self.clean_int(value) and self.clean_int(value) > 0})
        with self._request_context.tmdb_movie_cache_lock:
            missing = [value for value in ids if value not in self._tmdb_movie_cache_loaded_ids]
            if not missing or self._request_context.tmdb_movie_cache_unavailable:
                return
            try:
                with self._request_lock:
                    if self._request_context.tmdb_movie_details_cache is None:
                        self._request_context.tmdb_movie_details_cache = TmdbMovieDetailsCache()
                    cache = self._request_context.tmdb_movie_details_cache
                rows = cache.read_many(missing)
                with self._request_lock:
                    self._tmdb_movie_cache_rows.update(rows)
                    self._request_context.tmdb_movie_cache_loaded_ids.update(missing)
                    self._request_context.tmdb_movie_cache_persisted_ids.update(rows)
                    self._tmdb_metrics["tmdb_persistent_cache_rows_loaded"] = self._tmdb_metrics.get("tmdb_persistent_cache_rows_loaded", 0) + len(rows)
            except Exception as error:
                with self._request_lock:
                    self._request_context.tmdb_movie_cache_unavailable = True
                    self._request_context.tmdb_movie_cache_loaded_ids.update(missing)
                    self._tmdb_metrics["tmdb_cache_read_failures"] = self._tmdb_metrics.get("tmdb_cache_read_failures", 0) + 1
                self.trace_note(f"tmdb_cache_read_failed | error={type(error).__name__}")

    def tmdbMovieDetails(self, tmdb_id, *, allow_missing=False, force_refresh=False):
        movie_id = self.clean_int(tmdb_id)
        if not movie_id or movie_id <= 0:
            return {}
        self._loadTmdbMovieDetailsCache([movie_id])
        cached = self._tmdb_movie_cache_rows.get(movie_id)
        if cached and not force_refresh and is_archived_release(cached.get("original_release_date")):
            data = validate_movie_details(cached.get("payload"), movie_id)
            if data is not None:
                key = (f"movie/{movie_id}", tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())))
                event = {
                    "outcome": "cached",
                    "reason": "archived_tmdb_details",
                    "source": {
                        "tmdb_id": str(movie_id),
                        "fetched_at": cached.get("fetched_at"),
                        "original_release_date": cached.get("original_release_date"),
                        "response_profile": cached.get("response_profile"),
                        "cache_format_version": cached.get("cache_format_version"),
                    },
                }
                with self._request_lock:
                    persisted_hit = movie_id in self._tmdb_movie_cache_persisted_ids
                    if persisted_hit:
                        self._tmdb_metrics["tmdb_persistent_detail_hits"] = self._tmdb_metrics.get("tmdb_persistent_detail_hits", 0) + 1
                    else:
                        self._tmdb_metrics["tmdb_run_cache_detail_hits"] = self._tmdb_metrics.get("tmdb_run_cache_detail_hits", 0) + 1
                    self._tmdb_metrics.setdefault("tmdb_archived_movie_ids", set()).add(movie_id)
                    prior = self._request_context.tmdb_observations.get(key)
                    if persisted_hit or prior is None:
                        self._request_context.tmdb_observations[key] = event
                return copy.deepcopy(data)
        return self.tmdbGet(f"movie/{movie_id}", TMDB_MOVIE_DETAILS_PARAMS, allow_missing=allow_missing)

    def _saveTmdbMovieDetails(self, data, key):
        try:
            movie_id = self.clean_int(data.get("id"))
            if not movie_id:
                return
            valid = validate_movie_details(data, movie_id)
            if valid is None:
                raise ValueError("incomplete canonical TMDb details response")
            with self._request_lock:
                if self._request_context.tmdb_movie_details_cache is None:
                    self._request_context.tmdb_movie_details_cache = TmdbMovieDetailsCache()
                cache = self._request_context.tmdb_movie_details_cache
                event = self._request_context.tmdb_observations.get(key) or {}
            row = cache.write(movie_id, valid, fetched_at=event.get("checked_at"))
            with self._request_lock:
                self._tmdb_movie_cache_rows[movie_id] = {
                    "payload": valid,
                    "original_release_date": row.get("original_release_date"),
                    "fetched_at": row.get("fetched_at"),
                    "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
                    "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
                }
                self._tmdb_movie_cache_loaded_ids.add(movie_id)
                self._tmdb_movie_cache_persisted_ids.discard(movie_id)
                self._tmdb_metrics["tmdb_cache_writes"] = self._tmdb_metrics.get("tmdb_cache_writes", 0) + 1
                if is_archived_release(row.get("original_release_date")):
                    self._tmdb_metrics.setdefault("tmdb_archived_movie_ids", set()).add(movie_id)
        except Exception as error:
            with self._request_lock:
                self._tmdb_metrics["tmdb_cache_write_failures"] = self._tmdb_metrics.get("tmdb_cache_write_failures", 0) + 1
            self.trace_note(f"tmdb_cache_write_failed | error={type(error).__name__}")

    def updateProviders(self, new_row, existing, tmdb_id):
        self._provider_executor = self._request_context.get_provider_executor()
        futures = [self._provider_executor.submit(self.updateLetterboxd, new_row, existing, tmdb_id), self._provider_executor.submit(self.updateRottenTomatoes, new_row, existing)]
        for future in futures:
            future.result()

    def resolveLetterboxd(self, tmdb_id):
        url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
        status, delay = None, 0
        self._request_local.letterboxd_failure = ("failed", "resolution_failed")
        # One direct probe, then all of the existing bootstrap opportunities.
        for attempt in range(self.LETTERBOXD_MAX_ATTEMPTS + 1):
            if delay:
                time.sleep(delay)
            if attempt:
                self.resetRequestSession(url)
                try:
                    self.requestGet("https://letterboxd.com/", headers=self.requests_headers, timeout=20, attempts=1, check_status=False).close()
                except DataflowRequestError:
                    pass
            try:
                with self.requestGet(url, headers=self.requests_headers, timeout=20, attempts=1, check_status=False, allow_redirects=False) as response:
                    status = response.status_code
                    self._request_local.letterboxd_failure = ({403: ("blocked", "http_403"), 429: ("rate_limited", "http_429"), 404: ("no_listing", "http_404")}.get(status, ("parse_error", "unexpected_resolution_response") if status < 400 else ("failed", "http_failure")))
                    location = response.headers.get("Location")
                    if status in (301, 302, 303, 307, 308) and location:
                        film_url = location if location.startswith(("http://", "https://")) else "https://letterboxd.com" + location
                        if "/film/" not in film_url:
                            self._request_local.letterboxd_failure = ("no_listing", "no_film_redirect")
                        return film_url if "/film/" in film_url else None
                    if status == 403 and (attempt == 0 or any(token in response.text.lower() for token in ("just a moment", "cf-challenge", "challenge-platform"))):
                        delay = 0.5 if attempt else 0
                        continue
                    if status in (429, 500, 502, 503, 504):
                        delay = self.retryDelay(response, attempt)
                        if delay > 20:
                            break
                        continue
                    break
            except DataflowRequestError as error:
                self._request_local.letterboxd_failure = failure(error)
                delay = self.retryDelay(None, attempt)
                continue
        self.trace_note(f"provider_unavailable | source=letterboxd | tmdb={tmdb_id} | status={status}")
        return None

    def closeDataflowRequests(self):
        for session in self._request_sessions:
            session.close()
        self._request_sessions = []
        self._request_local = local()
        if self._owns_request_context:
            self._request_context.close()
            self._request_next = self._request_context.request_next
            self._tmdb_cache = self._request_context.tmdb_cache
            self._tmdb_executor = None
            self._provider_executor = None
            self._update_tmdb = {}
