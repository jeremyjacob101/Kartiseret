"""Immutable compressed compact matching summaries and small D1 pointers."""
import gzip
import json
from hashlib import sha256

MATCHING_SUMMARY_TYPE = "tmdb_matching_summary"
D1_SUMMARY_LIMIT = 16 * 1024


class MatchingSummaryStorage:
    def save_matching_summary(self, document, *, name, created_at=None, identity_namespace=""):
        from backend.utils.log.compact_matching import canonical, document_totals
        from backend.utils.log.run_storage import (_hash, _r2_client, _safe_segment,
            utc_now, write_recovery_envelope, remove_recovery_envelope, redact_secrets,
            CloudflareStorageError)
        document = json.loads(redact_secrets(canonical(document)))
        if document.get("evidence_format_version") != 2 or not isinstance(document.get("groups"), list):
            raise CloudflareStorageError("Matching summary has an unsupported format")
        run_id = int(document["run_id"])
        timestamp = created_at or utc_now()
        raw = canonical(document).encode()
        compressed = gzip.compress(raw, mtime=0)
        digest = sha256(raw).hexdigest()
        artifact_id = _hash(f"matching-summary-v2:{run_id}:{name}:{identity_namespace}")
        key = f"runs/{timestamp[:10]}/{run_id}/matching_summaries/{_safe_segment(name)}-{digest[:20]}.json.gz"
        metadata = {"version": 2, "size_bytes": len(compressed), "uncompressed_bytes": len(raw),
                    "content_sha256": digest, "compressed_sha256": sha256(compressed).hexdigest(),
                    "group_count": len(document["groups"])}
        pointer = {"evidence_format_version": 2, "run_id": run_id, "artifact_id": artifact_id,
                   "totals": document_totals(document)}
        if len(canonical(pointer).encode()) + len(canonical({"version": 2}).encode()) > D1_SUMMARY_LIMIT:
            raise CloudflareStorageError("Matching summary pointer exceeds 16 KiB")
        recovery = write_recovery_envelope("matching_summaries", artifact_id,
            {"run_id": run_id, "name": name, "created_at": timestamp,
             "identity_namespace": identity_namespace, "object_key": key}, compressed)
        existing = self.d1.execute(
            "SELECT artifact_id, run_id, object_key, metadata_json FROM artifacts WHERE artifact_id = ?",
            (artifact_id,)).rows
        catalog_rows_written = 0
        if existing:
            if json.loads(existing[0]["metadata_json"]).get("content_sha256") != digest:
                raise CloudflareStorageError("Matching summary identity conflicts with existing content")
            self.read_matching_summary(existing[0])
        else:
            client = self.r2 or _r2_client()
            client.put_object(Bucket=self.bucket, Key=key, Body=compressed, ContentType="application/gzip",
                Metadata={"run-id": str(run_id), "artifact-type": MATCHING_SUMMARY_TYPE, "created-at": timestamp})
            catalog = {"artifact_id": artifact_id, "run_id": run_id,
                       "object_key": key, "metadata_json": canonical(metadata)}
            self.read_matching_summary(catalog)
            catalog_rows_written = self._insert_artifact_row(artifact_id=artifact_id, run_id=run_id,
                artifact_type=MATCHING_SUMMARY_TYPE, name=name, object_key=key,
                content_type="application/gzip", text_content="", metadata=metadata, created_at=timestamp)
        registered = self.d1.execute(
            "SELECT artifact_id, run_id, object_key, metadata_json FROM artifacts WHERE artifact_id = ?",
            (artifact_id,)).rows
        if len(registered) != 1 or json.loads(registered[0]["metadata_json"]).get("content_sha256") != digest:
            raise CloudflareStorageError("Matching summary catalog registration was not confirmed")
        pointer_rows_written = self.save_text_artifact(run_id=run_id, artifact_type="tmdb_matching_evidence", name=name,
            text=canonical(pointer), metadata={"version": 2}, created_at=timestamp,
            identity_namespace=identity_namespace)
        self._last_matching_summary_rows_written = catalog_rows_written + pointer_rows_written
        remove_recovery_envelope(recovery)
        return pointer

    def read_matching_summary(self, catalog):
        from backend.utils.log.run_storage import _r2_client, CloudflareStorageError
        from backend.utils.log.compact_matching import canonical
        metadata = json.loads(catalog["metadata_json"])
        if not catalog["object_key"].startswith(f"runs/") or "/matching_summaries/" not in catalog["object_key"]:
            raise CloudflareStorageError("Matching summary key is invalid")
        response = (self.r2 or _r2_client()).get_object(Bucket=self.bucket, Key=catalog["object_key"])
        body = response["Body"]
        try:
            compressed = body.read()
        finally:
            body.close()
        if len(compressed) != metadata.get("size_bytes") or sha256(compressed).hexdigest() != metadata.get("compressed_sha256"):
            raise CloudflareStorageError("Matching summary compressed checksum mismatch")
        try:
            raw = gzip.decompress(compressed)
            document = json.loads(raw)
        except (OSError, EOFError, ValueError) as error:
            raise CloudflareStorageError("Matching summary is corrupt") from error
        if (sha256(raw).hexdigest() != metadata.get("content_sha256")
                or len(raw) != metadata.get("uncompressed_bytes")
                or document.get("evidence_format_version") != 2
                or document.get("run_id") != catalog["run_id"]
                or not isinstance(document.get("groups"), list)
                or len(document["groups"]) != metadata.get("group_count")
                or any(not isinstance(g, dict) or g.get("evidence_format_version") != 2
                       or g.get("run_id") != document["run_id"] for g in document["groups"])
                or canonical(document).encode() != raw):
            raise CloudflareStorageError("Matching summary content/identity mismatch")
        return document

    def resolve_matching_pointer(self, pointer):
        from backend.utils.log.run_storage import CloudflareStorageError
        rows = self.d1.execute(
            "SELECT artifact_id, run_id, object_key, metadata_json FROM artifacts WHERE artifact_id = ?",
            (pointer["artifact_id"],)).rows
        if len(rows) != 1 or rows[0]["run_id"] != pointer["run_id"]:
            raise CloudflareStorageError("Matching summary reference is missing or belongs to another run")
        document = self.read_matching_summary(rows[0])
        from backend.utils.log.compact_matching import document_totals
        if document_totals(document) != pointer["totals"]:
            raise CloudflareStorageError("Matching summary totals mismatch")
        return document
