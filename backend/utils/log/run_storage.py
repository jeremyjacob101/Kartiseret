"""Run-log, scraped-row, and private R2 artifact persistence."""

from __future__ import annotations

from datetime import datetime, timezone
import gzip
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import threading
import uuid

from backend.utils.log.cloudflare_storage import (
    CloudflareStorageError,
    D1Client,
    remove_recovery_envelope,
    redact_secrets,
    utc_now,
    write_recovery_envelope,
)


SCRAPED_COLUMNS = (
    "showtime", "english_title", "hebrew_title", "english_href", "hebrew_href",
    "screening_type", "screening_tech", "original_language", "dub_language",
    "date_of_showing", "release_year", "release_date", "directed_by", "runtime",
    "rating", "screening_city", "cinema",
)
SCRAPED_READ_PAGE_SIZE = 500
TEXT_ARTIFACT_READ_PAGE_SIZE = 25
SCRAPE_SNAPSHOT_TYPE = "scraped_snapshot"
SCRAPE_SNAPSHOT_VERSION = 1
_schema_lock = threading.Lock()
_schema_ready: set[str] = set()


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _hash(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def _sql_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple, set)):
        return _canonical(value)
    return str(value)


def _safe_segment(value: str) -> str:
    segment = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "artifact")).strip("._")
    return segment[:100] or "artifact"


def _r2_client():
    access_key = os.environ.get("RUN_ARTIFACTS_R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY", "").strip()
    if not access_key or not secret_key:
        raise CloudflareStorageError("Run-artifact R2 writer credentials are incomplete.")
    try:
        from backend.utils.log.r2_client import create_r2_s3_client
        return create_r2_s3_client(access_key=access_key, secret_key=secret_key)
    except Exception as error:
        from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

        if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
            raise
        raise CloudflareStorageError(f"Could not initialize guarded R2 client ({type(error).__name__}).") from error


class RunArtifactStore:
    def __init__(self, d1: D1Client | None = None, *, r2_client=None, bucket: str | None = None):
        self.d1 = d1 or D1Client.from_environment()
        self.r2 = r2_client
        self.bucket = (bucket or os.environ.get("RUN_ARTIFACTS_R2_BUCKET", "")).strip()
        if not self.bucket:
            raise CloudflareStorageError("RUN_ARTIFACTS_R2_BUCKET is required.")

    @property
    def schema_id(self) -> str:
        return self.d1.database_id

    def check_storage(self, *, lease_token: str | None = None) -> dict:
        from backend.utils.log.retention import cleanup_by_storage, HIGH_WATER_BYTES
        result = cleanup_by_storage(self, lease_token=lease_token)
        if result["size"] >= HIGH_WATER_BYTES:
            raise CloudflareStorageError("D1 storage is above the safe threshold; cleanup must make more room.")
        return result

    def ensure_schema(self) -> None:
        if self.schema_id in _schema_ready:
            return
        with _schema_lock:
            if self.schema_id in _schema_ready:
                return
            rows = self.d1.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')"
            ).rows
            existing = {row.get("name") for row in rows}
            required = {"run_locks", "run_logs", "scraped_rows", "gathering_rows", "artifacts", "diagnostics", "retention_state", "cleanup_state", "snapshot_migration_budget"}
            indexes = {"idx_scraped_rows_run_source", "idx_gathering_rows_run", "idx_artifacts_run_type", "idx_run_logs_started_at", "idx_diagnostics_run"}
            complete = required.union(indexes).issubset(existing)
            if complete:
                columns = self.d1.execute("PRAGMA table_info(run_locks)").rows
                complete = any(row.get("name") == "predecessor_run_id" for row in columns)
            if complete:
                rows = self.d1.execute(
                    "SELECT (SELECT COUNT(*) FROM run_locks WHERE id = 1) AS lock_count, "
                    "(SELECT COUNT(*) FROM retention_state WHERE id = 1) AS retention_count, "
                    "(SELECT COUNT(*) FROM cleanup_state WHERE id = 1) AS cleanup_count"
                ).rows
                complete = bool(rows and rows[0].get("lock_count") == 1 and rows[0].get("retention_count") == 1 and rows[0].get("cleanup_count") == 1)
            if not complete:
                migrations = (
                    Path(__file__).resolve().parents[3]
                    / "backend" / "cloudflare" / "d1" / "migrations"
                )
                for migration in sorted(migrations.glob("*.sql")):
                    try:
                        sql = migration.read_text(encoding="utf-8")
                    except OSError as error:
                        raise CloudflareStorageError("D1 migration file could not be read.") from error
                    for statement in sql.split(";"):
                        statement = statement.strip()
                        if statement:
                            if statement.startswith("ALTER TABLE run_locks ADD COLUMN predecessor_run_id"):
                                columns = self.d1.execute("PRAGMA table_info(run_locks)").rows
                                if any(row.get("name") == "predecessor_run_id" for row in columns):
                                    continue
                            self.d1.execute(statement)
            _schema_ready.add(self.schema_id)

    def acquire_run_lease(self, *, lease_hours: int = 5) -> str:
        from backend.utils.log.expiring_lease import ExpiringLeaseStore
        from backend.utils.log.job_lease import activate, control_request
        with control_request():
            self.ensure_schema()
            claim = ExpiringLeaseStore(self.d1).acquire()
        activate(self.d1, claim.token)
        self.predecessor_run_id = claim.predecessor_run_id
        return claim.token

    def renew_run_lease(self, token: str, *, lease_hours: int = 5) -> None:
        from backend.utils.log.expiring_lease import ExpiringLeaseStore
        from backend.utils.log.job_lease import control_request
        with control_request():
            ExpiringLeaseStore(self.d1).verify(token)

    def cleanup_state(self) -> dict:
        self.ensure_schema()
        rows = self.d1.execute("SELECT * FROM cleanup_state WHERE id = 1").rows
        if len(rows) != 1:
            raise CloudflareStorageError("Shared cleanup state is missing or malformed.")
        return rows[0]

    def mark_cleanup_attempt(self, day: str, *, successful: bool) -> None:
        column = "last_successful_cleanup_day" if successful else "last_dry_run_day"
        if column not in {"last_successful_cleanup_day", "last_dry_run_day"}:
            raise CloudflareStorageError("Invalid cleanup state column.")
        self.d1.execute(f"UPDATE cleanup_state SET {column} = ? WHERE id = 1", (day,))

    def attach_run_id_to_lease(self, token: str, run_id: int) -> None:
        result = self.d1.execute(
            "UPDATE run_locks SET run_id = ? WHERE id = 1 AND lease_token = ?",
            (run_id, token),
        )
        if result.changes != 1:
            raise CloudflareStorageError("Could not associate the D1 run lease with its Supabase run ID.")

    def release_run_lease(self, *, token: str | None = None, run_id: int | None = None,
                          reconcile_run_id: int | None = None) -> None:
        if not token:
            # A run ID alone cannot authorize releasing another machine's lease.
            return
        from backend.utils.log.expiring_lease import ExpiringLeaseStore
        from backend.utils.log.job_lease import control_request, deactivate
        if reconcile_run_id is not None:
            # Persist before stopping the heartbeat or releasing ownership. The
            # next host must clear an uncertain Supabase running_now flag even
            # when this worker exits cleanly after its finalization failed.
            result = self.d1.execute(
                "UPDATE run_locks SET predecessor_run_id = COALESCE(predecessor_run_id, ?) "
                "WHERE id = 1 AND lease_token = ?", (reconcile_run_id, token),
            )
            if result.changes != 1:
                raise CloudflareStorageError("Could not preserve the interrupted run for takeover; lease must expire.")
        healthy = deactivate(token)
        if healthy:
            with control_request():
                ExpiringLeaseStore(self.d1).release(token)

    def start_run(self, *, run_id: int, target: str, run_from: str, selected_runners=None) -> None:
        self.ensure_schema()
        self.d1.execute(
            "INSERT INTO run_logs (run_id, target, run_from, status, started_at, selected_runners_json, created_at) "
            "VALUES (?, ?, ?, 'running', ?, ?, ?)",
            (run_id, target, run_from, utc_now(), _canonical(selected_runners or []), utc_now()),
        )

    def finalize_run(
        self,
        *,
        run_id: int,
        successful: bool,
        total_time: float,
        selected_runners,
        error_type: str | None = None,
    ) -> None:
        status = "successful" if successful else "failed"
        result = self.d1.execute(
            "UPDATE run_logs SET status = ?, finished_at = ?, total_time = ?, "
            "selected_runners_json = ?, error_type = ? WHERE run_id = ?",
            (status, utc_now(), max(0.0, float(total_time)), _canonical(selected_runners or []), error_type or "", run_id),
        )
        if result.changes != 1:
            raise CloudflareStorageError(f"D1 did not finalize run {run_id}.")

    def mark_run_unconfirmed(self, run_id: int, reason: str, *, release_lease: bool = True) -> None:
        result = self.d1.execute(
            "UPDATE run_logs SET status = 'unconfirmed', finished_at = ?, error_type = ? WHERE run_id = ?",
            (utc_now(), reason[:100], run_id),
        )
        if result.changes != 1:
            raise CloudflareStorageError(f"D1 could not mark run {run_id} unconfirmed.")
        if release_lease:
            self.release_run_lease(run_id=run_id)

    def save_scraped_rows(
        self, *, run_id: int, scraper: str, attempt: int, successful: bool,
        rows: list[dict], insert_only: bool = False, batch_size: int = 50,
        row_order_start: int = 0, identity_namespace: str = "",
    ) -> int:
        if not rows:
            return 0
        outcome = "successful" if successful else "unsuccessful"
        normalized = []
        for row_order, row in enumerate(rows, start=max(0, int(row_order_start))):
            known = {column: _sql_value(row.get(column)) for column in SCRAPED_COLUMNS}
            extras = {str(key): value for key, value in row.items() if key not in SCRAPED_COLUMNS and key != "run_id"}
            identity = f"{run_id}:{scraper}:{attempt}:{row_order}"
            if identity_namespace:
                identity += f":{identity_namespace}"
            normalized.append({
                "row_key": _hash(identity),
                "run_id": int(run_id),
                "scraper": str(scraper),
                "attempt": int(attempt),
                "outcome": outcome,
                "row_order": row_order,
                **known,
                "source_run_id": _sql_value(row.get("run_id")),
                "extra_json": _canonical(extras),
                "created_at": utc_now(),
            })
        writes = self.save_scraped_snapshot(
            run_id=int(run_id), scraper=str(scraper), attempt=int(attempt), outcome=outcome,
            rows=normalized,
        )
        self._last_scraped_rows_changed = len(normalized) if writes else 0
        return writes

    def save_scraped_snapshot(
        self, *, run_id: int, scraper: str, attempt: int, outcome: str,
        rows: list[dict], recovery_identity: str | None = None,
    ) -> int:
        """Persist one immutable gzip snapshot and one D1 catalog reference."""
        if outcome not in {"successful", "unsuccessful"} or not rows:
            raise CloudflareStorageError("Scrape snapshots require rows and a valid attempt outcome.")
        ordered_rows = sorted((dict(row) for row in rows), key=lambda row: int(row.get("row_order", 0)))
        if any(int(row.get("run_id", -1)) != int(run_id) for row in ordered_rows):
            raise CloudflareStorageError("Scrape snapshot rows do not match their run ID.")
        identity = _hash(f"scraped-snapshot:{run_id}:{scraper}:{attempt}:{outcome}")
        comparable = [{key: value for key, value in row.items() if key != "created_at"} for row in ordered_rows]
        content_hash = _hash(_canonical(comparable))
        catalog_id = identity
        raw = _canonical({
            "version": SCRAPE_SNAPSHOT_VERSION, "run_id": int(run_id),
            "scraper": str(scraper), "attempt": int(attempt), "outcome": outcome,
            "rows": ordered_rows,
        }).encode("utf-8")
        compressed = gzip.compress(raw, mtime=0)
        compressed_hash = sha256(compressed).hexdigest()
        created_at = min((str(row.get("created_at") or utc_now()) for row in ordered_rows), default=utc_now())
        day = created_at[:10]
        object_key = (f"runs/{day}/{int(run_id)}/scraped_snapshots/"
                      f"{_safe_segment(scraper)}-{int(attempt)}-{content_hash[:20]}.json.gz")
        recovery_payload = {
            "run_id": int(run_id), "scraper": str(scraper), "attempt": int(attempt),
            "outcome": outcome, "object_key": object_key, "content_sha256": content_hash,
            "compressed_sha256": compressed_hash, "row_count": len(ordered_rows),
        }
        recovery = write_recovery_envelope(
            "scraped_snapshots", recovery_identity or identity, recovery_payload, compressed,
        )
        existing = self.d1.execute(
            "SELECT artifact_id, run_id, object_key, metadata_json FROM artifacts WHERE artifact_id = ?",
            (catalog_id,),
        ).rows
        if existing:
            try:
                old_metadata = json.loads(existing[0]["metadata_json"])
            except (KeyError, TypeError, ValueError) as error:
                raise CloudflareStorageError("Existing scrape snapshot catalog entry is malformed.") from error
            if old_metadata.get("content_sha256") != content_hash or old_metadata.get("row_count") != len(ordered_rows):
                raise CloudflareStorageError("Scraper attempt produced conflicting rows for an existing snapshot.")
            # A catalog row alone does not prove its object still exists or is
            # intact. Keep the recovery spool unless the referenced object also
            # passes the same checks archive readers require.
            self.read_scraped_snapshot(existing[0])
            remove_recovery_envelope(recovery)
            return 0
        client = self.r2 or _r2_client()
        try:
            client.put_object(
                Bucket=self.bucket, Key=object_key, Body=compressed,
                ContentType="application/gzip",
                Metadata={"run-id": str(run_id), "artifact-type": SCRAPE_SNAPSHOT_TYPE,
                          "content-sha256": content_hash, "created-at": created_at},
            )
        except Exception as error:
            from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded
            if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
                raise
            raise CloudflareStorageError(f"R2 scrape snapshot upload failed ({type(error).__name__}); local recovery copy retained.") from error
        metadata = {
            "version": SCRAPE_SNAPSHOT_VERSION, "scraper": str(scraper),
            "attempt": int(attempt), "outcome": outcome, "row_count": len(ordered_rows),
            "size_bytes": len(compressed), "content_sha256": content_hash,
            "compressed_sha256": compressed_hash,
        }
        try:
            self._insert_artifact_row(
                artifact_id=catalog_id, run_id=run_id, artifact_type=SCRAPE_SNAPSHOT_TYPE,
                name=f"{_safe_segment(scraper)}-{int(attempt)}", object_key=object_key,
                content_type="application/gzip", text_content="", metadata=metadata,
                created_at=created_at,
            )
        except Exception:
            # Keep the spool: the next identical attempt can safely retry the
            # content-addressed R2 put and complete the missing catalog entry.
            raise
        remove_recovery_envelope(recovery)
        return self._last_artifact_rows_written

    def save_gathering_rows(self, *, run_id: int, scraper: str, source_file: str, rows: list[dict]) -> int:
        """Import intermediate historical rows without inventing an attempt outcome."""
        fields = ("row_key", "run_id", "scraper", "source_file", "row_order", *SCRAPED_COLUMNS,
                  "source_run_id", "extra_json", "created_at")
        sql = (f"INSERT OR IGNORE INTO gathering_rows ({', '.join(fields)}) "
               f"VALUES ({', '.join('?' for _ in fields)})")
        payload = {"run_id": run_id, "scraper": scraper, "source_file": source_file, "rows": rows}
        recovery = write_recovery_envelope("gathering_rows", _hash(f"{run_id}:{source_file}"), payload)
        writes = changes = 0
        try:
            for start in range(0, len(rows), 25):
                batch = []
                for index, row in enumerate(rows[start:start + 25], start=start):
                    known = [_sql_value(row.get(column)) for column in SCRAPED_COLUMNS]
                    extras = {str(key): value for key, value in row.items() if key not in SCRAPED_COLUMNS and key != "run_id"}
                    params = (_hash(f"{run_id}:{source_file}:{index}"), run_id, scraper, source_file, index,
                              *known, _sql_value(row.get("run_id")), _canonical(extras), utc_now())
                    batch.append((sql, params))
                for result in self.d1.batch(batch):
                    writes += result.rows_written
                    changes += result.changes
        except Exception:
            raise
        else:
            remove_recovery_envelope(recovery)
        self._last_gathering_rows_changed = changes
        return writes

    def save_text_artifact(
        self,
        *,
        run_id: int | None,
        artifact_type: str,
        name: str,
        text: str,
        metadata: dict | None = None,
        created_at: str | None = None,
        identity_namespace: str = "",
    ) -> int:
        timestamp = created_at or utc_now()
        body = redact_secrets(str(text))
        artifact_id = _hash(f"{run_id}:{artifact_type}:{name}:{identity_namespace}:{_hash(body)}")
        safe_metadata = json.loads(redact_secrets(_canonical(metadata or {})))
        payload = {
            "environment": os.environ.get("KARTISERET_TARGET", ""), "run_id": run_id,
            "artifact_type": artifact_type, "artifact_name": name,
            "content_type": "text/plain; charset=utf-8", "text_content": body,
            "metadata": safe_metadata, "created_at": timestamp,
        }
        recovery = write_recovery_envelope("text_artifacts", artifact_id, payload)
        try:
            metadata_json = _canonical(safe_metadata)
            # Full values remain in metadata; bounded projections keep columns
            # searchable without allowing one exceptional field to block storage.
            def projection(value) -> str:
                return str(value or "")[:4096]
            # JSON escaping can make a request substantially larger than its UTF-8 text.
            # Budget the serialized parameters as well as the D1 row itself.
            fields = (artifact_id, run_id, artifact_type, name,
                      projection(safe_metadata.get("scraper") or safe_metadata.get("item_name")),
                      safe_metadata.get("attempt"), projection(safe_metadata.get("exception_type")),
                      projection(safe_metadata.get("url")), projection(safe_metadata.get("selector")),
                      projection(safe_metadata.get("publication_id")),
                      projection(safe_metadata.get("error_message")),
                      projection(safe_metadata.get("call_chain")),
                      projection(safe_metadata.get("outcome")), timestamp)
            overhead = len(json.dumps(fields).encode("utf-8")) + 4096
            capacity = 700_000 - overhead
            if capacity < 1024:
                raise CloudflareStorageError("Diagnostic metadata is too large for a safe D1 request; recovery copy retained.")
            def split_text(value: str, maximum: int) -> list[str]:
                pieces = []
                while value:
                    low, high = 1, min(len(value), maximum)
                    while low <= high:
                        middle = (low + high) // 2
                        if len(json.dumps(value[:middle]).encode("utf-8")) <= maximum:
                            low = middle + 1
                        else:
                            high = middle - 1
                    if high == 0:
                        raise CloudflareStorageError("Diagnostic text could not be safely chunked.")
                    pieces.append(value[:high])
                    value = value[high:]
                return pieces or [""]

            if len(json.dumps(body).encode("utf-8")) + len(json.dumps(metadata_json).encode("utf-8")) <= capacity:
                chunks, metadata_chunks = [body], [metadata_json]
            else:
                chunks = split_text(body, capacity // 2)
                metadata_chunks = split_text(metadata_json, capacity // 2)
            total_chunks = max(len(chunks), len(metadata_chunks))
            writes = changes = 0
            for index in range(total_chunks):
                result = self.d1.execute(
                    "INSERT OR IGNORE INTO diagnostics "
                    "(diagnostic_id, chunk_index, chunk_count, run_id, diagnostic_type, diagnostic_name, "
                    "scraper, attempt, error_type, source_url, selector, publication_id, error_message, call_chain, outcome, text_content, metadata_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (artifact_id, index, total_chunks, run_id, artifact_type, name,
                     fields[4], fields[5], fields[6], fields[7], fields[8], fields[9], fields[10], fields[11], fields[12],
                     chunks[index] if index < len(chunks) else "",
                     metadata_chunks[index] if index < len(metadata_chunks) else "", timestamp),
                )
                writes += result.rows_written
                changes += result.changes
            self._last_artifact_rows_written = writes
            self._last_artifact_rows_changed = changes
        except Exception:
            raise
        else:
            remove_recovery_envelope(recovery)
        return self._last_artifact_rows_written

    def save_file_artifact(
        self,
        *,
        run_id: int | None,
        artifact_type: str,
        name: str,
        content: bytes,
        content_type: str,
        metadata: dict | None = None,
        created_at: str | None = None,
        compress_screenshot: bool = False,
    ) -> dict:
        if artifact_type not in {"screenshots", "historical_screenshot"} or content_type not in {"image/png", "image/webp", "image/jpeg"}:
            raise CloudflareStorageError("Only screenshot images may be stored in the run-artifact bucket.")
        timestamp = created_at or utc_now()
        upload_bytes = content
        if compress_screenshot:
            upload_bytes, content_type, compression = optimize_screenshot(content)
        else:
            compression = {}
        content_hash = sha256(upload_bytes).hexdigest()
        day = timestamp[:10]
        suffix = {
            "image/webp": ".webp", "image/png": ".png",
            "image/jpeg": ".jpg",
        }.get(content_type, ".bin")
        run_segment = str(int(run_id)) if run_id is not None else "unassigned"
        object_key = f"runs/{day}/{run_segment}/{_safe_segment(artifact_type)}/{_safe_segment(name)}-{content_hash[:24]}{suffix}"
        artifact_id = _hash(f"{run_id}:{artifact_type}:{name}:{content_hash}")
        full_metadata = {**(metadata or {}), **compression, "sha256": content_hash, "size_bytes": len(upload_bytes)}
        payload = {
            "environment": os.environ.get("KARTISERET_TARGET", ""), "run_id": run_id,
            "artifact_type": artifact_type, "artifact_name": name, "object_key": object_key,
            "content_type": content_type, "metadata": full_metadata, "created_at": timestamp,
        }
        recovery = write_recovery_envelope("file_artifacts", artifact_id, payload, upload_bytes)
        try:
            client = self.r2 or _r2_client()
            try:
                client.put_object(
                    Bucket=self.bucket, Key=object_key, Body=upload_bytes,
                    ContentType=content_type,
                    Metadata={"run-id": str(run_id or "unassigned"), "artifact-type": _safe_segment(artifact_type), "created-at": timestamp},
                )
            except Exception as error:
                from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
                    raise
                raise CloudflareStorageError(f"R2 screenshot upload failed ({type(error).__name__}); local recovery copy retained.") from error
            self._insert_artifact_row(
                artifact_id=artifact_id, run_id=run_id, artifact_type=artifact_type,
                name=name, object_key=object_key, content_type=content_type,
                text_content="", metadata=full_metadata, created_at=timestamp,
            )
        except Exception:
            # If R2 succeeded but D1 did not, preserve the local copy so an
            # operator can reconcile the orphaned object without re-scraping.
            raise
        remove_recovery_envelope(recovery)
        return {
            "object_key": object_key, "content_type": content_type,
            "d1_rows_written": self._last_artifact_rows_written, **full_metadata,
        }

    def _insert_artifact_row(
        self, *, artifact_id: str, run_id: int | None, artifact_type: str, name: str,
        object_key: str, content_type: str, text_content: str, metadata: dict, created_at: str,
    ) -> int:
        result = self.d1.execute(
            "INSERT OR IGNORE INTO artifacts "
            "(artifact_id, run_id, artifact_type, artifact_name, object_key, content_type, text_content, metadata_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (artifact_id, run_id, artifact_type, name, object_key, content_type, text_content, _canonical(metadata), created_at),
        )
        self._last_artifact_rows_written = result.rows_written
        self._last_artifact_rows_changed = result.changes
        return result.rows_written

    def insert_imported_run(self, run: dict) -> int:
        """Insert legacy run metadata without replacing an already-imported run."""
        self.ensure_schema()
        result = self.d1.execute(
            "INSERT OR IGNORE INTO run_logs "
            "(run_id, target, run_from, status, started_at, finished_at, total_time, selected_runners_json, error_type, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                int(run["run_id"]), str(run.get("target") or "production"),
                str(run.get("run_from") or "historical_import"), str(run.get("status") or "unconfirmed"),
                str(run["started_at"]), run.get("finished_at"), run.get("total_time"),
                _canonical(run.get("selected_runners") or []), str(run.get("error_type") or ""),
                str(run.get("created_at") or run["started_at"]),
            ),
        )
        self._last_imported_run_changed = result.changes
        return result.rows_written

    def read_scraped_snapshot(self, catalog: dict) -> dict:
        """Fetch and verify one catalogued snapshot before exposing its rows."""
        if not isinstance(catalog.get("object_key"), str) or not catalog["object_key"].startswith("runs/"):
            raise CloudflareStorageError("Scrape snapshot catalog contains an invalid R2 key.")
        try:
            metadata = json.loads(catalog["metadata_json"])
        except (KeyError, TypeError, ValueError) as error:
            raise CloudflareStorageError("Scrape snapshot catalog metadata is malformed.") from error
        client = self.r2 or _r2_client()
        try:
            response = client.get_object(Bucket=self.bucket, Key=catalog["object_key"])
            body = response["Body"]
            compressed = body.read()
            close = getattr(body, "close", None)
            if close:
                close()
        except Exception as error:
            raise CloudflareStorageError(f"Referenced R2 scrape snapshot could not be read ({type(error).__name__}).") from error
        if sha256(compressed).hexdigest() != metadata.get("compressed_sha256"):
            raise CloudflareStorageError("R2 scrape snapshot checksum does not match its D1 catalog entry.")
        try:
            document = json.loads(gzip.decompress(compressed))
        except (OSError, EOFError, UnicodeDecodeError, ValueError) as error:
            raise CloudflareStorageError("R2 scrape snapshot is corrupt or has an invalid format.") from error
        if not isinstance(document, dict):
            raise CloudflareStorageError("R2 scrape snapshot header is malformed.")
        try:
            expected = (int(catalog["run_id"]), metadata.get("scraper"), int(metadata.get("attempt", -1)), metadata.get("outcome"))
        except (KeyError, TypeError, ValueError) as error:
            raise CloudflareStorageError("Scrape snapshot catalog identity is malformed.") from error
        observed = (document.get("run_id"), document.get("scraper"), document.get("attempt"), document.get("outcome"))
        snapshot_rows = document.get("rows")
        if (metadata.get("version") != SCRAPE_SNAPSHOT_VERSION
                or document.get("version") != SCRAPE_SNAPSHOT_VERSION
                or observed != expected or not isinstance(snapshot_rows, list)
                or len(snapshot_rows) != metadata.get("row_count")
                or any(not isinstance(row, dict) for row in snapshot_rows)):
            raise CloudflareStorageError("R2 scrape snapshot header or row count does not match its catalog entry.")
        row_keys = [row.get("row_key") for row in snapshot_rows]
        if any(not isinstance(key, str) or not key for key in row_keys) or len(set(row_keys)) != len(row_keys):
            raise CloudflareStorageError("R2 scrape snapshot contains missing or duplicate row identities.")
        if any(row.get("run_id") != expected[0] for row in snapshot_rows):
            raise CloudflareStorageError("R2 scrape snapshot contains rows for another run.")
        try:
            row_orders = [int(row["row_order"]) for row in snapshot_rows]
            row_identities_match = all(
                row.get("scraper") == expected[1]
                and int(row.get("attempt", -1)) == expected[2]
                and row.get("outcome") == expected[3]
                for row in snapshot_rows
            )
        except (KeyError, TypeError, ValueError) as error:
            raise CloudflareStorageError("R2 scrape snapshot row identity is malformed.") from error
        if row_orders != sorted(row_orders) or not row_identities_match:
            raise CloudflareStorageError("R2 scrape snapshot rows do not match their ordered attempt identity.")
        identity_rows = [{key: value for key, value in row.items() if key != "created_at"} for row in snapshot_rows]
        if _hash(_canonical(identity_rows)) != metadata.get("content_sha256"):
            raise CloudflareStorageError("R2 scrape snapshot content checksum does not match its D1 catalog entry.")
        return {"metadata": metadata, "document": document, "rows": snapshot_rows}

    def read_scraped_rows_since(self, *, since_iso: str, limit: int = 50000) -> list[dict]:
        maximum = min(max(1, int(limit)), 50000)
        rows: list[dict] = []
        offset = 0
        while len(rows) < maximum:
            page_limit = min(SCRAPED_READ_PAGE_SIZE, maximum - len(rows))
            result = self.d1.execute(
                "SELECT s.*, r.started_at AS run_started_at, r.status AS d1_run_status "
                "FROM scraped_rows s JOIN run_logs r ON r.run_id = s.run_id "
                "WHERE r.started_at >= ? "
                "ORDER BY r.started_at, s.run_id, s.scraper, s.attempt, s.row_order "
                "LIMIT ? OFFSET ?",
                (since_iso, page_limit, offset),
            )
            rows.extend(result.rows)
            if len(result.rows) < page_limit:
                break
            offset += len(result.rows)
        # Catalog reads share the same limit. During migration, catalog snapshots
        # overlap legacy D1 rows, so identity-based merging avoids double counts.
        catalogs: list[dict] = []
        offset = 0
        while len(catalogs) < maximum:
            page_limit = min(SCRAPED_READ_PAGE_SIZE, maximum - len(catalogs))
            result = self.d1.execute(
                "SELECT a.artifact_id, a.run_id, a.artifact_name, a.object_key, a.metadata_json, a.created_at, "
                "r.started_at AS run_started_at, r.status AS d1_run_status "
                "FROM artifacts a JOIN run_logs r ON r.run_id = a.run_id "
                "WHERE a.artifact_type = ? AND r.started_at >= ? "
                "ORDER BY r.started_at, a.run_id, a.artifact_name, a.artifact_id LIMIT ? OFFSET ?",
                (SCRAPE_SNAPSHOT_TYPE, since_iso, page_limit, offset),
            )
            catalogs.extend(result.rows)
            if len(result.rows) < page_limit:
                break
            offset += len(result.rows)
        for catalog in catalogs:
            snapshot = self.read_scraped_snapshot(catalog)
            for row in snapshot["rows"]:
                rows.append({**row, "artifact_id": catalog["artifact_id"],
                             "run_started_at": catalog["run_started_at"], "d1_run_status": catalog["d1_run_status"]})
        # Prefer R2 when old D1 rows and their verified replacement overlap.
        deduplicated = {}
        for row in rows:
            key = row.get("row_key")
            if not isinstance(key, str) or not key:
                raise CloudflareStorageError("Scrape archive row has no stable identity.")
            current = deduplicated.get(key)
            if current is None or row.get("artifact_id"):
                deduplicated[key] = row
        output = sorted(
            deduplicated.values(),
            key=lambda row: (str(row.get("run_started_at", "")), int(row.get("run_id", 0)),
                             str(row.get("scraper", "")), int(row.get("attempt", 0)), int(row.get("row_order", 0))),
        )
        return output[:maximum]

    def read_text_artifacts_since(self, *, since_iso: str, limit: int = 10000) -> list[dict]:
        maximum = min(max(1, int(limit)), 10000)
        rows: list[dict] = []
        offset = 0
        while len(rows) < maximum:
            page_limit = min(TEXT_ARTIFACT_READ_PAGE_SIZE, maximum - len(rows))
            result = self.d1.execute(
                "SELECT artifact_id, run_id, artifact_type, artifact_name, content_type, text_content, metadata_json, created_at, 0 AS chunk_index, 1 AS chunk_count "
                "FROM artifacts WHERE created_at >= ? AND text_content <> '' UNION ALL "
                "SELECT diagnostic_id AS artifact_id, run_id, diagnostic_type AS artifact_type, diagnostic_name AS artifact_name, "
                "'text/plain; charset=utf-8' AS content_type, text_content, metadata_json, created_at, chunk_index, chunk_count "
                "FROM diagnostics WHERE created_at >= ? "
                "ORDER BY created_at, run_id, artifact_type, artifact_name, artifact_id, chunk_index "
                "LIMIT ? OFFSET ?",
                (since_iso, since_iso, page_limit, offset),
            )
            rows.extend(result.rows)
            if len(result.rows) < page_limit:
                break
            offset += len(result.rows)
        combined: dict[str, dict] = {}
        for row in rows:
            identity = row.get("artifact_id")
            item = combined.setdefault(identity, {**row, "_chunks": []})
            item["_chunks"].append((int(row.get("chunk_index", 0)), str(row.get("text_content") or ""), str(row.get("metadata_json") or "")))
        output = []
        for item in combined.values():
            chunks = sorted(item.pop("_chunks"))
            expected = int(item.get("chunk_count", 1))
            if [index for index, _, _ in chunks] != list(range(expected)):
                raise CloudflareStorageError("A diagnostic is incomplete; refusing to return partial text.")
            item["text_content"] = "".join(text for _, text, _ in chunks)
            item["metadata_json"] = "".join(metadata for _, _, metadata in chunks)
            output.append(item)
        return output

    def mark_run_failed(self, run_id: int, *, reason: str) -> None:
        result = self.d1.execute(
            "UPDATE run_logs SET status = 'failed', finished_at = ?, error_type = ? WHERE run_id = ?",
            (utc_now(), reason[:100], run_id),
        )
        if result.changes != 1:
            raise CloudflareStorageError(f"D1 did not mark run {run_id} failed.")
        self.release_run_lease(run_id=run_id)


def optimize_screenshot(png_bytes: bytes, *, quality: int = 82, max_width: int = 1920) -> tuple[bytes, str, dict]:
    """Return a readable WebP when smaller, otherwise the original PNG."""
    try:
        from PIL import Image
    except ImportError:
        return png_bytes, "image/png", {"compression": "png_fallback", "compression_reason": "Pillow unavailable"}
    original = png_bytes
    original_pixel_limit = Image.MAX_IMAGE_PIXELS
    try:
        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(BytesIO(png_bytes)) as source:
            if source.width * source.height > 40_000_000:
                return original, "image/png", {"compression": "png_fallback", "compression_reason": "image exceeds the 40 megapixel safety limit"}
            source.load()
            image = source.convert("RGB")
            original_width, original_height = image.size
            if original_width > max_width:
                new_height = max(1, round(original_height * max_width / original_width))
                image = image.resize((max_width, new_height), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.save(output, format="WEBP", quality=quality, method=6)
            converted = output.getvalue()
            if len(converted) < len(original):
                return converted, "image/webp", {
                    "compression": "webp", "quality": quality,
                    "original_width": original_width, "original_height": original_height,
                    "width": image.width, "height": image.height,
                    "original_size_bytes": len(original),
                }
            return original, "image/png", {
                "compression": "png_fallback", "compression_reason": "WebP was not smaller",
                "original_width": original_width, "original_height": original_height,
                "width": original_width, "height": original_height,
            }
    except Exception as error:
        return original, "image/png", {
            "compression": "png_fallback", "compression_reason": type(error).__name__,
        }
    finally:
        Image.MAX_IMAGE_PIXELS = original_pixel_limit
