from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from threading import RLock, local
from urllib.parse import urlsplit
import copy, requests, time


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
        self.tmdb_executor = None
        self.provider_executor = None
        self.request_workers = request_workers
        self.provider_workers = provider_workers
        self.requests_per_second = requests_per_second

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
            data = pending.result()
            if not data and not allow_missing:
                raise DataflowRequestError(f"TMDB resource missing: {path}")
            return copy.deepcopy(data)

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
            pending.set_result(data)
            if not data:
                with self._request_lock:
                    self._tmdb_cache.pop(key, None)
            return copy.deepcopy(data)
        except BaseException as error:
            # Wake other callers even when the cache owner is interrupted.
            pending.set_exception(error)
            with self._request_lock:
                self._tmdb_cache.pop(key, None)
            raise

    def tmdbExecutor(self):
        self._tmdb_executor = self._request_context.get_tmdb_executor()
        return self._tmdb_executor

    def fetchTmdbDetails(self, candidates):
        def fetch(tmdb_id):
            data = self.tmdbGet(f"movie/{tmdb_id}", {"append_to_response": "external_ids,credits"}, allow_missing=True)
            return tmdb_id, data

        # map retains candidate order even when later requests finish first.
        return {tmdb_id: data for tmdb_id, data in self.tmdbExecutor().map(fetch, candidates) if data}

    def prepareUpdateTmdb(self, rows):
        ids = list(dict.fromkeys(self.clean_int(row.get("tmdb_id")) for row in rows if self.clean_int(row.get("tmdb_id"))))
        self._update_tmdb = dict(zip(ids, self.tmdbExecutor().map(self.tmdbForUpdate, ids)))

    def tmdbForUpdate(self, tmdb_id):
        if tmdb_id in self._update_tmdb:
            return self._update_tmdb[tmdb_id]
        try:
            return self.tmdbGet(f"movie/{tmdb_id}", {"append_to_response": "external_ids,videos"}, allow_missing=True)
        except DataflowRequestError:
            self.trace_note(f"provider_unavailable | source=tmdb | tmdb={tmdb_id}")
            return {}

    def updateProviders(self, new_row, existing, tmdb_id):
        self._provider_executor = self._request_context.get_provider_executor()
        futures = [self._provider_executor.submit(self.updateLetterboxd, new_row, existing, tmdb_id), self._provider_executor.submit(self.updateRottenTomatoes, new_row, existing)]
        for future in futures:
            future.result()

    def resolveLetterboxd(self, tmdb_id):
        url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
        status, delay = None, 0
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
                    location = response.headers.get("Location")
                    if status in (301, 302, 303, 307, 308) and location:
                        film_url = location if location.startswith(("http://", "https://")) else "https://letterboxd.com" + location
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
            except DataflowRequestError:
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
