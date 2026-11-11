"""Replace a completed run's diagnostics with verified compact records; dry-run by default."""
import argparse
from collections import Counter, defaultdict
import json

from backend.utils.log.cloudflare_storage import (
    CloudflareStorageError, recovery_root, write_recovery_envelope, remove_recovery_envelope)
from backend.utils.log.compact_matching import canonical, compact_document, compact_dataflow_summary
from backend.utils.log.run_storage import _hash
from backend.utils.log.tmdb_matching_report import build_tmdb_matching_report


def source_rows(store, run_id):
    rows = []
    for offset in range(0, 100000, 10):
        page = store.d1.execute(
            "SELECT * FROM diagnostics WHERE run_id=? ORDER BY diagnostic_id,chunk_index LIMIT 10 OFFSET ?",
            (run_id, offset)).rows
        rows.extend(page)
        if len(page) < 10:
            return rows
    raise CloudflareStorageError("Diagnostic source exceeds bounded scan")


def prepare(rows):
    artifacts = defaultdict(list)
    for row in rows:
        artifacts[row["diagnostic_id"]].append(row)
    replacements = []
    total_bytes = 0
    for chunks in artifacts.values():
        chunks.sort(key=lambda r: r["chunk_index"])
        first = chunks[0]
        if [r["chunk_index"] for r in chunks] != list(range(first["chunk_count"])):
            raise CloudflareStorageError("Original diagnostic is incomplete")
        for r in chunks:
            if any(r[k] != first[k] for k in ("run_id", "diagnostic_type", "diagnostic_name", "chunk_count", "created_at")):
                raise CloudflareStorageError("Original diagnostic chunk identity differs")
        text = "".join(r["text_content"] for r in chunks)
        metadata = json.loads("".join(r["metadata_json"] for r in chunks))
        kind = first["diagnostic_type"]
        if kind == "tmdb_matching_evidence":
            original = json.loads(text)
            compact = compact_document(original)
            if build_tmdb_matching_report(original["groups"]) != build_tmdb_matching_report(compact["groups"]):
                raise CloudflareStorageError("Compact matching report differs from original")
            if len(compact["groups"]) != len(original["groups"]):
                raise CloudflareStorageError("Matching groups were lost")
            total_bytes += len(canonical(compact).encode())
            replacement = {"document": compact}
        elif kind == "dataflow_summary":
            compact = compact_dataflow_summary(metadata)
            replacement = {"text": canonical(compact), "metadata": {
                "summary_format_version": 2, "name": metadata.get("name"),
                "attempt": metadata.get("attempt"), "successful": metadata.get("successful"),
                "publication_pending": bool(metadata.get("publication_pending"))}}
        elif kind in {"scraper_transport", "publication_receipt"}:
            try:
                text = canonical(json.loads(text))
            except ValueError:
                pass
            replacement = {"text": text, "metadata": metadata}
        else:
            raise CloudflareStorageError("Unexpected source diagnostic type; inspect before replacement")
        replacements.append({**replacement, "run_id": first["run_id"], "kind": kind,
            "name": first["diagnostic_name"], "created_at": first["created_at"]})
    if total_bytes >= 2_000_000:
        raise CloudflareStorageError("Compact matching summaries exceed 2 MB acceptance target")
    return replacements, total_bytes


def replace(store, *, run_id, target, apply=False, expected_source_rows=179,
            expected_source_sha256=None, lease_guard=None):
    def verify_owner():
        if lease_guard:
            getattr(lease_guard, "verify", lease_guard)()
        owners = store.d1.execute("SELECT status,target,finished_at FROM run_logs WHERE run_id=?", (run_id,)).rows
        if len(owners) != 1 or owners[0]["status"] != "successful" or owners[0]["target"] != target or not owners[0]["finished_at"]:
            raise CloudflareStorageError("Diagnostic replacement requires a confirmed successful target run")
    verify_owner()
    identity = f"{target}-{run_id}-v2"
    journal_path = recovery_root() / "diagnostic_replacements" / f"{identity}.json"
    journal = (journal_path, None)
    if journal_path.exists():
        payload = json.loads(journal_path.read_text())
        if payload.get("run_id") != run_id or payload.get("target") != target:
            raise CloudflareStorageError("Replacement journal owner differs")
        rows = payload["rows"]
        source_sha256 = _hash(canonical(rows))
        if source_sha256 != payload["source_sha256"]:
            raise CloudflareStorageError("Replacement journal checksum differs")
        if expected_source_sha256 and source_sha256 != expected_source_sha256:
            raise CloudflareStorageError("Captured source identities differ from the approved source set")
    else:
        rows = source_rows(store, run_id)
        if len(rows) != expected_source_rows:
            namespace = "compact-replacement-v2"
            if rows and all(r["chunk_count"] == 1 and r["chunk_index"] == 0 and
                r["diagnostic_id"] == _hash(f"{run_id}:{r['diagnostic_type']}:{r['diagnostic_name']}:{namespace}:{_hash(r['text_content'])}") for r in rows):
                for row in rows:
                    if row["diagnostic_type"] == "tmdb_matching_evidence":
                        store.resolve_matching_pointer(json.loads(row["text_content"]))
                return {"run_id": run_id, "target": target, "mode": "already-replaced",
                        "remaining_records": len(rows), "deleted_rows": 0, "delete_writes": 0}
            raise CloudflareStorageError("Original diagnostic count differs; inspect before replacement")
        if expected_source_sha256 and _hash(canonical(rows)) != expected_source_sha256:
            raise CloudflareStorageError("Captured source identities differ from the approved source set")
    replacements, compact_bytes = prepare(rows)
    result = {"run_id": run_id, "target": target, "mode": "apply" if apply else "dry-run",
        "source_rows": len(rows), "replacement_records": len(replacements),
        "source_identity_sha256": _hash(canonical(rows)),
        "source_text_bytes": sum(len(r["text_content"].encode()) for r in rows),
        "compact_matching_bytes": compact_bytes, "deleted_rows": 0, "delete_writes": 0,
        "replacement_d1_writes": 0}
    if not apply:
        return result
    journal = write_recovery_envelope("diagnostic_replacements", identity, {
        "run_id": run_id, "target": target, "rows": rows, "source_sha256": _hash(canonical(rows))})
    namespace = "compact-replacement-v2"
    for item in replacements:
        verify_owner()
        if "document" in item:
            pointer = store.save_matching_summary(item["document"], name=item["name"],
                created_at=item["created_at"], identity_namespace=namespace)
            result["replacement_d1_writes"] += getattr(store, "_last_matching_summary_rows_written", 0)
            if store.resolve_matching_pointer(pointer) != item["document"]:
                raise CloudflareStorageError("Replacement summary download differs")
            body, metadata = canonical(pointer), {"version": 2}
        else:
            body, metadata = item["text"], item["metadata"]
            result["replacement_d1_writes"] += store.save_text_artifact(run_id=run_id, artifact_type=item["kind"], name=item["name"],
                text=body, metadata=metadata, created_at=item["created_at"], identity_namespace=namespace)
        diagnostic_id = _hash(f"{run_id}:{item['kind']}:{item['name']}:{namespace}:{_hash(body)}")
        actual = store.d1.execute(
            "SELECT chunk_index,chunk_count,text_content,metadata_json FROM diagnostics WHERE diagnostic_id=? ORDER BY chunk_index",
            (diagnostic_id,)).rows
        if (not actual or [r["chunk_index"] for r in actual] != list(range(actual[0]["chunk_count"]))
                or "".join(r["text_content"] for r in actual) != body
                or json.loads("".join(r["metadata_json"] for r in actual)) != metadata):
            raise CloudflareStorageError("Replacement diagnostic was not verified")
    # Only after every replacement has been independently verified may any original disappear.
    for start in range(0, len(rows), 25):
        verify_owner()
        batch = rows[start:start + 25]
        identities = canonical([[r["diagnostic_id"], r["chunk_index"]] for r in batch])
        predicate = "run_id=? AND (diagnostic_id,chunk_index) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))"
        present = store.d1.execute("SELECT * FROM diagnostics WHERE " + predicate, (run_id, identities)).rows
        expected = {(r["diagnostic_id"], r["chunk_index"]): r for r in batch}
        if any(r != expected[(r["diagnostic_id"], r["chunk_index"])] for r in present):
            raise CloudflareStorageError("Original diagnostic changed since capture")
        if present:
            deletion = store.d1.execute("DELETE FROM diagnostics WHERE " + predicate, (run_id, identities))
            result["deleted_rows"] += deletion.changes
            result["delete_writes"] += deletion.rows_written
        if store.d1.execute("SELECT count(*) n FROM diagnostics WHERE " + predicate, (run_id, identities)).rows[0]["n"]:
            raise CloudflareStorageError("Original deletion could not be verified; journal retained")
    remaining = source_rows(store, run_id)
    result["remaining_records"] = len(remaining)
    result["replacement_d1_bytes"] = sum(len(r["text_content"].encode()) + len(r["metadata_json"].encode()) for r in remaining)
    remove_recovery_envelope(journal)
    return result


def main():
    from dotenv import load_dotenv
    from backend.utils.log.shared_cleanup import _load_target, maintenance_lease, lease_renewal_callback
    from backend.utils.log.run_storage import RunArtifactStore
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--expected-source-rows", type=int, default=179)
    parser.add_argument("--expected-source-sha256", help="Require the exact previously captured source-row set")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    _load_target(args.target)
    if args.apply:
        with maintenance_lease() as (store, token):
            result = replace(store, run_id=args.run_id, target=args.target, apply=True,
                expected_source_rows=args.expected_source_rows,
                expected_source_sha256=args.expected_source_sha256,
                lease_guard=lease_renewal_callback(store, token))
    else:
        result = replace(RunArtifactStore(), run_id=args.run_id, target=args.target,
                         expected_source_rows=args.expected_source_rows,
                         expected_source_sha256=args.expected_source_sha256)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
