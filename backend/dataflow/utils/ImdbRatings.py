from pathlib import Path
from threading import RLock
import csv, gzip, hashlib, json, os, requests, tempfile, time

from backend.dataflow.utils.DataflowRequests import DataflowRequestError
from backend.dataflow.utils.ProviderFreshness import utc_now, observation, failure


_ratings_lock = RLock()
_ratings_version = None
_ratings_values = {}
_ratings_known_ids = set()
_ratings_validated = set()


class ImdbRatings:
    IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
    IMDB_CACHE_DIR = Path(tempfile.gettempdir()) / ("kartiseret-imdb-" + hashlib.sha256(str(Path.home()).encode()).hexdigest()[:12])

    def imdbFileSignature(self, path):
        stat = path.stat()
        return str(path), stat.st_size, stat.st_mtime_ns

    def scanImdbRatings(self, path, imdb_ids):
        ratings = {}
        with gzip.open(path, "rt", encoding="utf-8") as ratings_file:
            dataset_rows = csv.reader(ratings_file, delimiter="\t")
            header = next(dataset_rows, [])
            columns = [header.index(name) for name in ("tconst", "averageRating", "numVotes")]
            max_column = max(columns)
            for row in dataset_rows:
                if len(row) <= max_column or row[columns[0]] not in imdb_ids:
                    continue
                try:
                    ratings[row[columns[0]]] = {"rating": float(row[columns[1]]), "votes": int(row[columns[2]])}
                except ValueError:
                    continue
        # Read to EOF so gzip truncation/CRC errors cannot enter the shared cache.
        if len(path.name) == 71 and path.name.endswith(".tsv.gz"):
            with path.open("rb") as compressed_file:
                if hashlib.file_digest(compressed_file, "sha256").hexdigest() != path.name[:64]:
                    raise ValueError("IMDb cache digest mismatch")
        _ratings_validated.add(self.imdbFileSignature(path))
        return ratings

    def imdbRatingsPath(self):
        started = utc_now()
        cache = Path(self.IMDB_CACHE_DIR)
        cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        metadata_path = cache / "metadata.json"
        metadata = {}
        if metadata_path.is_file():
            try:
                metadata = json.loads(metadata_path.read_text())
                if not isinstance(metadata, dict):
                    metadata = {}
            except (OSError, ValueError):
                pass
        filename = str(metadata.get("file") or "")
        cached_path = cache / filename
        has_cache = len(filename) == 71 and filename.endswith(".tsv.gz") and all(c in "0123456789abcdef" for c in filename[:64]) and cached_path.is_file()
        headers = {"If-None-Match": metadata["etag"]} if has_cache and metadata.get("etag") else {}
        if has_cache and not headers and metadata.get("last_modified"):
            headers["If-Modified-Since"] = metadata["last_modified"]

        for attempt in range(3):
            temporary = None
            try:
                with self.requestGet(self.IMDB_RATINGS_URL, headers=headers, stream=True, timeout=(10, 120), attempts=1) as response:
                    if response.status_code == 304 and has_cache:
                        if self.imdbFileSignature(cached_path) not in _ratings_validated:
                            self.scanImdbRatings(cached_path, set())
                        self._imdb_observation = observation("success", "dataset_validated", {"dataset_sha256": cached_path.name[:64], "etag": str(metadata.get("etag") or "")[:256], "last_modified": str(metadata.get("last_modified") or "")[:256], "retrieved_at": metadata.get("retrieved_at"), "http_status": 304}, started)
                        return cached_path
                    if response.status_code != 200:
                        raise DataflowRequestError(f"IMDb dataset returned HTTP {response.status_code}", status=response.status_code)
                    digest = hashlib.sha256()
                    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as ratings_file:
                        temporary = Path(ratings_file.name)
                        for chunk in response.iter_content(chunk_size=1024 * 1024):
                            if chunk:
                                digest.update(chunk)
                                ratings_file.write(chunk)
                    self.scanImdbRatings(temporary, set())
                    cached_path = cache / f"{digest.hexdigest()}.tsv.gz"
                    os.replace(temporary, cached_path)
                    _ratings_validated.add(self.imdbFileSignature(cached_path))
                    temporary = None
                    metadata = {"file": cached_path.name, "etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified"), "retrieved_at": utc_now()}
                with tempfile.NamedTemporaryFile(mode="w", dir=cache, delete=False) as metadata_file:
                    temporary = Path(metadata_file.name)
                    json.dump(metadata, metadata_file)
                os.replace(temporary, metadata_path)
                temporary = None
                # Immutable versioned files keep concurrent readers on a consistent dataset.
                for old_path in cache.glob("*.tsv.gz"):
                    if old_path != cached_path and time.time() - old_path.stat().st_mtime > 7 * 86400:
                        old_path.unlink(missing_ok=True)
                self._imdb_observation = observation("success", "dataset_validated", {"dataset_sha256": cached_path.name[:64], "etag": str(metadata.get("etag") or "")[:256], "last_modified": str(metadata.get("last_modified") or "")[:256], "retrieved_at": metadata.get("retrieved_at"), "http_status": 200}, started)
                return cached_path
            except (DataflowRequestError, requests.RequestException, OSError, EOFError, ValueError) as error:
                self._imdb_observation = observation(*failure(error), {}, started)
                if isinstance(error, DataflowRequestError) and error.status in (400, 401, 403, 404):
                    break
                headers = {}
                has_cache = False
                delay = error.retry_after if isinstance(error, DataflowRequestError) and error.retry_after is not None else 0.5 * 2 ** attempt
                if delay > 20:
                    break
                if attempt < 2:
                    time.sleep(delay)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        raise DataflowRequestError("IMDb ratings download or validation failed")

    def loadImdbRatings(self, rows):
        global _ratings_version, _ratings_values, _ratings_known_ids
        self._imdb_observation = None
        started = utc_now()
        imdb_ids = set()
        for row in rows:
            tmdb = self._update_tmdb.get(self.clean_int(row.get("tmdb_id"))) or {}
            imdb_id = (tmdb.get("external_ids") or {}).get("imdb_id") or row.get("imdb_id")
            if imdb_id := self.clean_str(imdb_id).strip():
                imdb_ids.add(imdb_id)
        if not imdb_ids:
            return {}
        with _ratings_lock:
            try:
                path = self.imdbRatingsPath()
                version = str(path)
                if version != _ratings_version:
                    _ratings_version, _ratings_values, _ratings_known_ids = version, {}, set()
                missing_ids = imdb_ids - _ratings_known_ids
                if missing_ids:
                    _ratings_values.update(self.scanImdbRatings(path, missing_ids))
                    _ratings_known_ids.update(missing_ids)
                return {imdb_id: dict(_ratings_values[imdb_id]) for imdb_id in imdb_ids if imdb_id in _ratings_values}
            except (DataflowRequestError, OSError, EOFError, ValueError) as error:
                if self._imdb_observation is None or self._imdb_observation.get("outcome") == "success":
                    self._imdb_observation = observation(*failure(error), {}, started)
                self.trace_note("provider_unavailable | source=imdb")
                return {}
