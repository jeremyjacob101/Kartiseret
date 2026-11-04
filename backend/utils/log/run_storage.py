"""Run-log, scraped-row, and private R2 artifact persistence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
    try:
        import boto3
        from botocore.config import Config
    except ImportError as error:
        raise CloudflareStorageError("boto3 is required to write run artifacts to R2.") from error

    account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    access_key = os.environ.get("RUN_ARTIFACTS_R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY", "").strip()
    if not account_id or not access_key or not secret_key:
        raise CloudflareStorageError("Run-artifact R2 writer credentials are incomplete.")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        region_name="auto",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", retries={"total_max_attempts": 1, "mode": "standard"}),
    )


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

    def ensure_schema(self) -> None:
        if self.schema_id in _schema_ready:
            return
        with _schema_lock:
            if self.schema_id in _schema_ready:
                return
            rows = self.d1.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).rows
            existing = {row.get("name") for row in rows}
            required = {"run_locks", "run_logs", "scraped_rows", "artifacts"}
            if not required.issubset(existing):
                migration = (
                    Path(__file__).resolve().parents[3]
                    / "backend" / "cloudflare" / "d1" / "migrations" / "0001_run_artifacts.sql"
                )
                try:
                    sql = migration.read_text(encoding="utf-8")
                except OSError as error:
                    raise CloudflareStorageError("D1 migration file could not be read.") from error
                for statement in sql.split(";"):
                    statement = statement.strip()
                    if statement:
                        self.d1.execute(statement)
            _schema_ready.add(self.schema_id)

    def acquire_run_lease(self, *, lease_hours: int = 5) -> str:
        self.ensure_schema()
        token = uuid.uuid4().hex
        now = datetime.now(timezone.utc)
        now_text = now.isoformat(timespec="seconds")
        expiry = (now + timedelta(hours=lease_hours)).isoformat(timespec="seconds")
        result = self.d1.execute(
            "UPDATE run_locks SET lease_token = ?, run_id = NULL, lease_until = ? "
            "WHERE id = 1 AND lease_until <= ?",
            (token, expiry, now_text),
        )
        if result.changes != 1:
            raise CloudflareStorageError(
                "Another scraper run holds the D1 run lease; no run was started."
            )
        return token

    def attach_run_id_to_lease(self, token: str, run_id: int) -> None:
        result = self.d1.execute(
            "UPDATE run_locks SET run_id = ? WHERE id = 1 AND lease_token = ?",
            (run_id, token),
        )
        if result.changes != 1:
            raise CloudflareStorageError("Could not associate the D1 run lease with its Supabase run ID.")

    def release_run_lease(self, *, token: str | None = None, run_id: int | None = None) -> None:
        if token:
            result = self.d1.execute(
                "UPDATE run_locks SET lease_token = '', run_id = NULL, lease_until = '1970-01-01T00:00:00+00:00' "
                "WHERE id = 1 AND lease_token = ?",
                (token,),
            )
        elif run_id is not None:
            result = self.d1.execute(
                "UPDATE run_locks SET lease_token = '', run_id = NULL, lease_until = '1970-01-01T00:00:00+00:00' "
                "WHERE id = 1 AND run_id = ?",
                (run_id,),
            )
        else:
            return
        if result.changes != 1:
            if token:
                raise CloudflareStorageError("The D1 run lease could not be released or no longer belongs to this run.")

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

    def mark_run_unconfirmed(self, run_id: int, reason: str) -> None:
        result = self.d1.execute(
            "UPDATE run_logs SET status = 'unconfirmed', finished_at = ?, error_type = ? WHERE run_id = ?",
            (utc_now(), reason[:100], run_id),
        )
        if result.changes != 1:
            raise CloudflareStorageError(f"D1 could not mark run {run_id} unconfirmed.")
        self.release_run_lease(run_id=run_id)

    def save_scraped_rows(
        self, *, run_id: int, scraper: str, attempt: int, successful: bool,
        rows: list[dict], insert_only: bool = False, batch_size: int = 50,
        row_order_start: int = 0,
    ) -> int:
        if not rows:
            return 0
        outcome = "successful" if successful else "unsuccessful"
        normalized = []
        for row_order, row in enumerate(rows, start=max(0, int(row_order_start))):
            known = {column: _sql_value(row.get(column)) for column in SCRAPED_COLUMNS}
            extras = {str(key): value for key, value in row.items() if key not in SCRAPED_COLUMNS and key != "run_id"}
            identity = f"{run_id}:{scraper}:{attempt}:{row_order}"
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
        payload = {
            "environment": os.environ.get("KARTISERET_TARGET", ""),
            "run_id": int(run_id), "scraper": str(scraper), "attempt": int(attempt),
            "outcome": outcome, "rows": normalized,
        }
        identity = _hash(_canonical(payload))
        recovery = write_recovery_envelope("scraped_rows", f"{run_id}-{scraper}-{attempt}-{identity[:16]}", payload)
        fields = (
            "row_key", "run_id", "scraper", "attempt", "outcome", "row_order", *SCRAPED_COLUMNS,
            "source_run_id", "extra_json", "created_at",
        )
        updates = ", ".join(
            f"{field} = excluded.{field}"
            for field in fields
            if field not in {"row_key", "run_id", "scraper", "attempt", "row_order"}
        )
        conflict = "DO NOTHING" if insert_only else f"DO UPDATE SET {updates}"
        sql = (
            f"INSERT INTO scraped_rows ({', '.join(fields)}) "
            f"VALUES ({', '.join('?' for _ in fields)}) "
            f"ON CONFLICT(row_key) {conflict}"
        )
        writes = 0
        changes = 0
        try:
            for start in range(0, len(normalized), max(1, int(batch_size))):
                statements = [
                    (sql, tuple(row.get(field, "") for field in fields))
                    for row in normalized[start:start + max(1, int(batch_size))]
                ]
                batch_results = self.d1.batch(statements)
                writes += sum(result.rows_written for result in batch_results)
                changes += sum(result.changes for result in batch_results)
        except Exception:
            # No inline retry: the spool is retained even if D1 may have committed.
            raise
        else:
            remove_recovery_envelope(recovery)
        self._last_scraped_rows_changed = changes
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
    ) -> int:
        timestamp = created_at or utc_now()
        body = redact_secrets(str(text))
        artifact_id = _hash(f"{run_id}:{artifact_type}:{name}:{_hash(body)}")
        payload = {
            "environment": os.environ.get("KARTISERET_TARGET", ""), "run_id": run_id,
            "artifact_type": artifact_type, "artifact_name": name,
            "content_type": "text/plain; charset=utf-8", "text_content": body,
            "metadata": metadata or {}, "created_at": timestamp,
        }
        recovery = write_recovery_envelope("text_artifacts", artifact_id, payload)
        try:
            self._insert_artifact_row(
                artifact_id=artifact_id, run_id=run_id, artifact_type=artifact_type,
                name=name, object_key="", content_type="text/plain; charset=utf-8",
                text_content=body, metadata=metadata or {}, created_at=timestamp,
            )
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
        timestamp = created_at or utc_now()
        upload_bytes = content
        if content_type.startswith("text/"):
            upload_bytes = redact_secrets(content.decode("utf-8", errors="replace")).encode("utf-8")
        if compress_screenshot:
            upload_bytes, content_type, compression = optimize_screenshot(content)
        else:
            compression = {}
        content_hash = sha256(upload_bytes).hexdigest()
        day = timestamp[:10]
        suffix = {
            "image/webp": ".webp", "image/png": ".png",
            "text/plain; charset=utf-8": ".txt", "text/csv; charset=utf-8": ".csv",
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
            client.put_object(
                Bucket=self.bucket, Key=object_key, Body=upload_bytes,
                ContentType=content_type,
                Metadata={"run-id": str(run_id or "unassigned"), "artifact-type": _safe_segment(artifact_type), "created-at": timestamp},
            )
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
        return rows

    def read_text_artifacts_since(self, *, since_iso: str, limit: int = 10000) -> list[dict]:
        maximum = min(max(1, int(limit)), 10000)
        rows: list[dict] = []
        offset = 0
        while len(rows) < maximum:
            page_limit = min(TEXT_ARTIFACT_READ_PAGE_SIZE, maximum - len(rows))
            result = self.d1.execute(
                "SELECT artifact_id, run_id, artifact_type, artifact_name, content_type, text_content, metadata_json, created_at "
                "FROM artifacts WHERE created_at >= ? AND text_content <> '' "
                "ORDER BY created_at, run_id, artifact_type, artifact_name, artifact_id "
                "LIMIT ? OFFSET ?",
                (since_iso, page_limit, offset),
            )
            rows.extend(result.rows)
            if len(result.rows) < page_limit:
                break
            offset += len(result.rows)
        return rows

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

