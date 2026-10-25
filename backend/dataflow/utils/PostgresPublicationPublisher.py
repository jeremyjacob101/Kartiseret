"""Publish a prepared category through a restricted PostgreSQL login.

Large payloads are staged with COPY into a temporary table, then copied into
the RLS-protected durable staging tables. Live catalog changes run in one
bounded transaction through a publisher-only SQL entry point.
"""

from __future__ import annotations

from contextlib import contextmanager
import json
import logging
import os
from pathlib import Path
import tempfile
import time
from urllib.parse import parse_qs, urlsplit

import psycopg
from psycopg.rows import dict_row


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_STAGING_TIMEOUT_SECONDS = 120
_PUBLICATION_TIMEOUT_SECONDS = 300
_TRANSACTION_TIMEOUT_SECONDS = 330


class PostgresPublicationPublisher:
    def __init__(self, database_url: str, ssl_ca_certificate: str | None, *, test_mode: bool = False):
        parsed = urlsplit(database_url)
        if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
            raise ValueError("PUBLICATION_DATABASE_URL must be a PostgreSQL URL")
        if parsed.username is None or parsed.password is None:
            raise ValueError("PUBLICATION_DATABASE_URL must identify the restricted publisher login")

        is_local = parsed.hostname.lower() in _LOCAL_HOSTS
        if test_mode:
            if not is_local:
                raise ValueError("PUBLICATION_DATABASE_TEST_MODE only permits loopback hosts")
            if ssl_ca_certificate:
                raise ValueError("Local publication tests must not configure a remote CA certificate")
        else:
            if is_local:
                raise ValueError("Remote publisher configuration cannot use a loopback host")
            try:
                port = parsed.port
            except ValueError as error:
                raise ValueError("PUBLICATION_DATABASE_URL has an invalid port") from error
            if port not in {None, 5432}:
                raise ValueError("PUBLICATION_DATABASE_URL must use a direct or session-mode port (5432)")
            if parsed.username.split(".", 1)[0] != "kartiseret_publisher_login":
                raise ValueError("PUBLICATION_DATABASE_URL must use kartiseret_publisher_login")
            if not ssl_ca_certificate or not ssl_ca_certificate.strip():
                raise ValueError("PUBLICATION_DATABASE_SSL_CA_CERT is required for verified TLS")
            query = parse_qs(parsed.query, keep_blank_values=True)
            if query.get("sslmode", ["verify-full"]) != ["verify-full"]:
                raise ValueError("PUBLICATION_DATABASE_URL must not weaken verified TLS")
            forbidden_tls_options = {"sslrootcert", "sslcert", "sslkey", "sslpassword", "sslcrl", "sslcrldir"}
            if forbidden_tls_options.intersection(query):
                raise ValueError("Set the publisher CA only through PUBLICATION_DATABASE_SSL_CA_CERT")
        self.database_url = database_url
        self.ssl_ca_certificate = ssl_ca_certificate
        self.test_mode = test_mode

    @classmethod
    def from_environment(cls) -> "PostgresPublicationPublisher | None":
        database_url = (os.environ.get("PUBLICATION_DATABASE_URL") or "").strip()
        certificate = os.environ.get("PUBLICATION_DATABASE_SSL_CA_CERT")
        test_mode = os.environ.get("PUBLICATION_DATABASE_TEST_MODE") == "true"
        if not database_url:
            if certificate and certificate.strip():
                raise ValueError("PUBLICATION_DATABASE_SSL_CA_CERT requires PUBLICATION_DATABASE_URL")
            if test_mode:
                raise ValueError("PUBLICATION_DATABASE_TEST_MODE requires PUBLICATION_DATABASE_URL")
            return None
        return cls(database_url, certificate, test_mode=test_mode)

    @contextmanager
    def _connect(self):
        certificate_path = None
        try:
            if self.test_mode:
                connect_options = {"sslmode": "disable"}
            else:
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", prefix="kartiseret-publisher-ca-", delete=False
                ) as certificate_file:
                    certificate_file.write(self.ssl_ca_certificate)
                    certificate_file.flush()
                    certificate_path = Path(certificate_file.name)
                certificate_path.chmod(0o600)
                connect_options = {
                    "sslmode": "verify-full",
                    "sslrootcert": str(certificate_path),
                }

            connection = psycopg.connect(
                self.database_url,
                connect_timeout=10,
                application_name="kartiseret-publication",
                autocommit=True,
                row_factory=dict_row,
                **connect_options,
            )
            try:
                with connection:
                    yield connection
            finally:
                connection.close()
        finally:
            if certificate_path is not None:
                certificate_path.unlink(missing_ok=True)

    @staticmethod
    def _set_transaction_limits(cursor, *, statement_seconds: int, transaction_seconds: int) -> None:
        cursor.execute("SET LOCAL ROLE kartiseret_publisher")
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout = '30s'")
        cursor.execute("SELECT set_config('statement_timeout', %s, true)", (f"{statement_seconds}s",))
        cursor.execute("SELECT set_config('transaction_timeout', %s, true)", (f"{transaction_seconds}s",))

    @staticmethod
    def _check_identity(header, identity) -> None:
        if header is None:
            raise RuntimeError("Publication receipt disappeared while staging")
        expected = (
            identity["category"],
            identity["run_id"],
            identity["fingerprint"],
            identity["part_count"],
        )
        actual = (header["category"], header["run_id"], header["fingerprint"], header["part_count"])
        if actual != expected:
            raise RuntimeError("Publication identity was reused with different content")

    def _stage(self, identity, parts):
        started = time.monotonic()
        try:
            result = self._stage_transaction(identity, parts)
        except Exception as error:
            logger.error(
                "publication_metric=%s",
                json.dumps({
                    "event": "publication_stage_failed",
                    "publication_id": identity["publication_id"],
                    "run_id": identity["run_id"],
                    "category": identity["category"],
                    "sqlstate": getattr(error, "sqlstate", None),
                    "error_type": type(error).__name__,
                    "seconds": round(time.monotonic() - started, 3),
                }, separators=(",", ":")),
            )
            raise
        if result is not None:
            logger.info(
                "publication_metric=%s",
                json.dumps({
                    "event": "publication_receipt_reused",
                    "publication_id": identity["publication_id"],
                    "run_id": identity["run_id"],
                    "category": identity["category"],
                    "status": result["status"],
                    "seconds": round(time.monotonic() - started, 3),
                }, separators=(",", ":")),
            )
        return result

    def _stage_transaction(self, identity, parts):
        started = time.monotonic()
        with self._connect() as connection:
            with connection.transaction():
                cursor = connection.cursor()
                self._set_transaction_limits(
                    cursor,
                    statement_seconds=_STAGING_TIMEOUT_SECONDS,
                    transaction_seconds=_STAGING_TIMEOUT_SECONDS,
                )
                cursor.execute(
                    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(%s, 0))",
                    (identity["publication_id"],),
                )
                cursor.execute(
                    """INSERT INTO public.pipeline_publications
                         (publication_id, category, run_id, fingerprint, part_count)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (publication_id) DO NOTHING""",
                    (
                        identity["publication_id"],
                        identity["category"],
                        identity["run_id"],
                        identity["fingerprint"],
                        identity["part_count"],
                    ),
                )
                cursor.execute(
                    """SELECT category, run_id, fingerprint, part_count, status, revision
                       FROM public.pipeline_publications
                       WHERE publication_id = %s""",
                    (identity["publication_id"],),
                )
                header = cursor.fetchone()
                self._check_identity(header, identity)
                if header["status"] == "applied":
                    return {"status": "applied", "revision": str(header["revision"])}
                if header["status"] != "prepared":
                    raise RuntimeError("Publication receipt has an unsupported state")

                cursor.execute(
                    """CREATE TEMP TABLE _kartiseret_publication_incoming (
                         part integer PRIMARY KEY,
                         payload text NOT NULL
                       ) ON COMMIT DROP"""
                )
                with cursor.copy(
                    "COPY pg_temp._kartiseret_publication_incoming (part, payload) FROM STDIN"
                ) as copy:
                    for part_number, payload in enumerate(parts):
                        copy.write_row((part_number, payload))

                cursor.execute(
                    """SELECT existing.part
                       FROM public.pipeline_publication_parts AS existing
                       JOIN pg_temp._kartiseret_publication_incoming AS incoming USING (part)
                       WHERE existing.publication_id = %s
                         AND existing.payload IS DISTINCT FROM incoming.payload
                       LIMIT 1""",
                    (identity["publication_id"],),
                )
                if cursor.fetchone() is not None:
                    raise RuntimeError("Prepared publication part differs from its immutable payload")

                cursor.execute(
                    """SELECT existing.part
                       FROM public.pipeline_publication_parts AS existing
                       LEFT JOIN pg_temp._kartiseret_publication_incoming AS incoming USING (part)
                       WHERE existing.publication_id = %s AND incoming.part IS NULL
                       LIMIT 1""",
                    (identity["publication_id"],),
                )
                if cursor.fetchone() is not None:
                    raise RuntimeError("Prepared publication contains an unexpected part")

                cursor.execute(
                    """INSERT INTO public.pipeline_publication_parts (publication_id, part, payload)
                       SELECT %s, incoming.part, incoming.payload
                       FROM pg_temp._kartiseret_publication_incoming AS incoming
                       LEFT JOIN public.pipeline_publication_parts AS existing
                         ON existing.publication_id = %s AND existing.part = incoming.part
                       WHERE existing.part IS NULL""",
                    (identity["publication_id"], identity["publication_id"]),
                )
                cursor.execute(
                    "SELECT count(*) AS staged_parts FROM public.pipeline_publication_parts WHERE publication_id = %s",
                    (identity["publication_id"],),
                )
                staged_parts = cursor.fetchone()["staged_parts"]
                if staged_parts != identity["part_count"]:
                    raise RuntimeError("Publication staging did not contain the expected number of parts")

        duration = round(time.monotonic() - started, 3)
        logger.info(
            "publication_metric=%s",
            json.dumps({
                "event": "publication_stage_complete",
                "publication_id": identity["publication_id"],
                "run_id": identity["run_id"],
                "category": identity["category"],
                "parts": staged_parts,
                "payload_bytes": sum(len(part.encode("utf-8")) for part in parts),
                "seconds": duration,
            }, separators=(",", ":")),
        )
        return None

    def _apply(self, identity):
        started = time.monotonic()
        try:
            with self._connect() as connection:
                transaction_started = time.monotonic()
                with connection.transaction():
                    cursor = connection.cursor()
                    self._set_transaction_limits(
                        cursor,
                        statement_seconds=_PUBLICATION_TIMEOUT_SECONDS,
                        transaction_seconds=_TRANSACTION_TIMEOUT_SECONDS,
                    )
                    function_started = time.monotonic()
                    cursor.execute(
                        "SELECT pipeline_internal.commit_category_publication_direct(%s, %s) AS result",
                        (identity["publication_id"], identity["fingerprint"]),
                    )
                    result = cursor.fetchone()["result"]
                    function_seconds = time.monotonic() - function_started
                    function_finished = time.monotonic()
                # Exiting connection.transaction() confirms the outer COMMIT.
                transaction_seconds = time.monotonic() - transaction_started
                commit_and_ack_seconds = time.monotonic() - function_finished
        except psycopg.Error as error:
            logger.error(
                "publication_metric=%s",
                json.dumps({
                    "event": "publication_apply_failed",
                    "publication_id": identity["publication_id"],
                    "run_id": identity["run_id"],
                    "category": identity["category"],
                    "sqlstate": error.sqlstate,
                    "phase": "outer_commit" if "function_seconds" in locals() else "publication_function",
                    "seconds": round(time.monotonic() - started, 3),
                    "commit_and_ack_seconds": round(
                        max(0.0, time.monotonic() - function_finished), 3
                    ) if "function_finished" in locals() else None,
                }, separators=(",", ":")),
            )
            raise
        if not isinstance(result, dict) or result.get("status") != "applied":
            raise RuntimeError("PostgreSQL did not confirm an applied publication")
        logger.info(
            "publication_metric=%s",
            json.dumps({
                "event": "publication_apply_committed",
                "publication_id": identity["publication_id"],
                "run_id": identity["run_id"],
                "category": identity["category"],
                "transaction_seconds": round(transaction_seconds, 3),
                "function_seconds": round(function_seconds, 3),
                "commit_and_ack_seconds": round(max(0.0, commit_and_ack_seconds), 3),
                "revision": str(result.get("revision")),
            }, separators=(",", ":")),
        )
        return result

    def _reconcile(self, identity):
        with self._connect() as connection:
            with connection.transaction():
                cursor = connection.cursor()
                self._set_transaction_limits(cursor, statement_seconds=10, transaction_seconds=10)
                cursor.execute(
                    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(%s, 0))",
                    (identity["publication_id"],),
                )
                cursor.execute(
                    """SELECT status, category, run_id, fingerprint, part_count, revision
                       FROM public.pipeline_publications
                       WHERE publication_id = %s""",
                    (identity["publication_id"],),
                )
                receipt = cursor.fetchone()
        if (
            receipt
            and receipt["status"] == "applied"
            and receipt["category"] == identity["category"]
            and receipt["run_id"] == identity["run_id"]
            and receipt["fingerprint"] == identity["fingerprint"]
            and receipt["part_count"] == identity["part_count"]
        ):
            return {"status": "applied", "revision": str(receipt["revision"])}
        return None

    def publish(self, identity, parts):
        stage_started = time.monotonic()
        try:
            existing = self._stage(identity, parts)
            if existing is not None:
                return existing
            return self._apply(identity)
        except Exception as error:
            # A connection can fail after PostgreSQL commits but before the
            # client receives the acknowledgement. The receipt is authoritative.
            try:
                receipt = self._reconcile(identity)
            except Exception as reconcile_error:
                logger.error(
                    "publication_metric=%s",
                    json.dumps({
                        "event": "publication_receipt_unconfirmed",
                        "publication_id": identity["publication_id"],
                        "run_id": identity["run_id"],
                        "category": identity["category"],
                        "error_type": type(reconcile_error).__name__,
                    }, separators=(",", ":")),
                )
                raise
            if receipt is not None:
                return receipt
            logger.info(
                "publication_metric=%s",
                json.dumps({
                    "event": "publication_failed_unapplied",
                    "publication_id": identity["publication_id"],
                    "run_id": identity["run_id"],
                    "category": identity["category"],
                    "sqlstate": getattr(error, "sqlstate", None),
                    "error_type": type(error).__name__,
                    "seconds": round(time.monotonic() - stage_started, 3),
                }, separators=(",", ":")),
            )
            raise
