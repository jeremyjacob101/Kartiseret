"""Keep the production homepage warm and clear it after catalog publications."""

from __future__ import annotations

import argparse
import fcntl
import logging
import os
import signal
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import psycopg
from psycopg.rows import dict_row
import requests
from dotenv import load_dotenv


LOGGER = logging.getLogger("kartiseret.cdn_cache_warmer")
POLL_INTERVAL_SECONDS = 20
PUBLIC_CATALOG_CACHE_TAG = "public-catalog"
SITE_URL = "https://seret.site/"
VERCEL_CACHE_DELETE_URL = "https://api.vercel.com/v1/edge-cache/dangerously-delete-by-tags"
PRODUCTION_PROJECT_REF = "gsdrcyrduxbrxgsvhxvr"
STATE_FILE = Path.home() / ".cache" / "kartiseret" / "cdn-cache-warmer-revision"
HTTP_TIMEOUT = (5, 10)


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required for the production cache warmer.")
    return value


def validate_configuration() -> tuple[str, str, str, str, str]:
    database_url = _required_environment("PROD_DATABASE_URL")
    ca_certificate = _required_environment("PROD_DATABASE_SSL_CA_CERT")
    vercel_token = _required_environment("VERCEL_API_TOKEN")
    project_id = _required_environment("VERCEL_PROJECT_ID")
    team_id = _required_environment("VERCEL_TEAM_ID")

    parsed = urlsplit(database_url)
    username = parsed.username or ""
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("PROD_DATABASE_URL has an invalid port.") from error

    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("PROD_DATABASE_URL must be a PostgreSQL URL.")
    if (
        PRODUCTION_PROJECT_REF not in parsed.hostname
        and PRODUCTION_PROJECT_REF not in username
    ):
        raise ValueError(
            "PROD_DATABASE_URL must point to the production Supabase project."
        )
    if username.split(".", 1)[0] != "kartiseret_api":
        raise ValueError(
            "The cache warmer requires the kartiseret_api runtime login, not the publisher login."
        )
    if port not in {None, 5432, 6543}:
        raise ValueError(
            "PROD_DATABASE_URL must use the Supabase direct or transaction pooler port."
        )
    if not ca_certificate.strip():
        raise ValueError("PROD_DATABASE_SSL_CA_CERT is required for verified TLS.")
    query = parse_qs(parsed.query, keep_blank_values=True)
    if query.get("sslmode", ["verify-full"]) != ["verify-full"]:
        raise ValueError("PROD_DATABASE_URL must not weaken verified TLS.")
    if {"sslrootcert", "sslcert", "sslkey", "sslpassword"}.intersection(query):
        raise ValueError("Configure the PostgreSQL CA only through PROD_DATABASE_SSL_CA_CERT.")

    return database_url, ca_certificate, vercel_token, project_id, team_id


class CatalogRevisionReader:
    def __init__(self, database_url: str, ca_certificate: str) -> None:
        certificate_file = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            prefix="kartiseret-cache-warmer-ca-",
            delete=False,
        )
        try:
            certificate_file.write(ca_certificate)
            certificate_file.flush()
            os.fchmod(certificate_file.fileno(), 0o600)
            self._certificate_path = Path(certificate_file.name)
        finally:
            certificate_file.close()

        self._database_url = database_url
        self._connection: psycopg.Connection | None = None

    def read(self) -> str:
        try:
            if self._connection is None or self._connection.closed:
                self._connection = psycopg.connect(
                    self._database_url,
                    connect_timeout=10,
                    application_name="kartiseret-cdn-cache-warmer",
                    autocommit=True,
                    prepare_threshold=None,
                    row_factory=dict_row,
                    sslmode="verify-full",
                    sslrootcert=str(self._certificate_path),
                )
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute(
                    "select revision::text from public.pipeline_catalog_revision where singleton"
                )
                row = cursor.fetchone()
            if row is None or not row["revision"]:
                raise RuntimeError("The production catalog revision is unavailable.")
            return str(row["revision"])
        except Exception:
            self.close_connection()
            raise

    def close_connection(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def close(self) -> None:
        self.close_connection()
        self._certificate_path.unlink(missing_ok=True)


def delete_cache_tag(
    token: str,
    project_id: str,
    team_id: str,
    *,
    request_post: Callable = requests.post,
) -> None:
    query = urlencode({"projectIdOrName": project_id, "teamId": team_id})
    response = request_post(
        f"{VERCEL_CACHE_DELETE_URL}?{query}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"tags": [PUBLIC_CATALOG_CACHE_TAG], "target": "production"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Vercel tag deletion returned HTTP {response.status_code}.")


def ping_homepage(*, request_get: Callable = requests.get) -> dict[str, object]:
    started = time.perf_counter()
    with request_get(
        SITE_URL,
        headers={"User-Agent": "Kartiseret-Cache-Warmer/1.0"},
        timeout=HTTP_TIMEOUT,
        stream=True,
        allow_redirects=True,
    ) as response:
        ttfb_ms = round((time.perf_counter() - started) * 1000, 1)
        response.raise_for_status()
        for _ in response.iter_content(chunk_size=64 * 1024):
            pass
        return {
            "status": response.status_code,
            "cache": response.headers.get("x-vercel-cache", "unknown"),
            "vercel_id": response.headers.get("x-vercel-id", "unknown"),
            "ttfb_ms": ttfb_ms,
        }


def load_saved_revision(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    if not value:
        return None
    return value


def save_revision(path: Path, revision: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary_file:
            temporary_file.write(revision + "\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            os.fchmod(temporary_file.fileno(), 0o600)
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def run_cycle(
    last_revision: str | None,
    *,
    read_revision: Callable[[], str],
    delete_tag: Callable[[], None],
    warm_homepage: Callable[[], dict[str, object]],
    persist_revision: Callable[[str], None],
) -> tuple[str | None, bool]:
    try:
        current_revision = read_revision()
    except Exception as error:
        LOGGER.warning("Could not read catalog revision (%s).", type(error).__name__)
        if last_revision is None:
            return None, False
        current_revision = last_revision

    if current_revision != last_revision:
        try:
            delete_tag()
        except Exception as error:
            LOGGER.error(
                "Could not delete public catalog cache for revision %s (%s).",
                current_revision,
                type(error).__name__,
            )
            return last_revision, False
        LOGGER.info("Deleted public catalog cache for revision %s.", current_revision)
        last_revision = current_revision
        try:
            persist_revision(current_revision)
        except OSError as error:
            LOGGER.error("Could not save warmer revision state (%s).", type(error).__name__)

    try:
        result = warm_homepage()
        LOGGER.info(
            "Homepage ping status=%s cache=%s vercel_id=%s ttfb_ms=%s revision=%s.",
            result["status"],
            result["cache"],
            result["vercel_id"],
            result["ttfb_ms"],
            current_revision,
        )
    except Exception as error:
        LOGGER.warning("Homepage warm request failed (%s).", type(error).__name__)
        return last_revision, False
    return last_revision, True


class WarmerAlreadyRunning(RuntimeError):
    pass


def acquire_singleton_lock(state_path: Path):
    lock_path = state_path.with_suffix(state_path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_file = lock_path.open("a", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        raise WarmerAlreadyRunning("The production cache warmer is already running.") from None
    return lock_file


def handle_shutdown_signal(_signal_number: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-config", action="store_true")
    parser.add_argument("--check-revision", action="store_true")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one production poll and homepage ping.",
    )
    args = parser.parse_args(argv)

    try:
        database_url, ca_certificate, token, project_id, team_id = validate_configuration()
    except ValueError as error:
        parser.error(str(error))

    if args.check_config:
        print("Production cache warmer configuration is valid.")
        return 0

    if args.check_revision:
        reader = CatalogRevisionReader(database_url, ca_certificate)
        try:
            print(f"Production catalog revision: {reader.read()}")
        finally:
            reader.close()
        return 0

    state_path = Path(
        os.environ.get("CACHE_WARMER_STATE_FILE", str(STATE_FILE))
    ).expanduser()
    try:
        lock_file = acquire_singleton_lock(state_path)
    except WarmerAlreadyRunning:
        if args.once:
            return 0
        raise
    reader = CatalogRevisionReader(database_url, ca_certificate)
    revision = load_saved_revision(state_path)
    signal.signal(signal.SIGTERM, handle_shutdown_signal)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    def cycle() -> tuple[str | None, bool]:
        return run_cycle(
            revision,
            read_revision=reader.read,
            delete_tag=lambda: delete_cache_tag(token, project_id, team_id),
            warm_homepage=ping_homepage,
            persist_revision=lambda value: save_revision(state_path, value),
        )

    try:
        if args.once:
            revision, succeeded = cycle()
            return 0 if revision is not None and succeeded else 1

        LOGGER.info(
            "Starting production homepage warmer with a %ss interval.",
            POLL_INTERVAL_SECONDS,
        )
        while True:
            started = time.monotonic()
            revision, _succeeded = cycle()
            delay = max(0.0, POLL_INTERVAL_SECONDS - (time.monotonic() - started))
            time.sleep(delay)
    except KeyboardInterrupt:
        LOGGER.info("Production homepage warmer stopped.")
        return 0
    finally:
        reader.close()
        lock_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
