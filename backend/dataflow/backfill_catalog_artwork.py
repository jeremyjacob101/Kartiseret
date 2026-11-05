"""Resumable catalog artwork backfill and conservative reference-based cleanup.

Dry-run is the default. Mutating operations refuse the production Supabase
project unless explicitly allowed. Cleanup callers hold the shared D1 lease.
"""
from __future__ import annotations

import argparse
import logging
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv
from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.dataflow.utils.ArtworkStorage import ArtworkStorage, VARIANTS

PRODUCTION_PROJECT_REF = "gsdrcyrduxbrxgsvhxvr"
TABLES = (
    ("finalMovies", "tmdb_id", "tmdb_id,en_poster,backdrop,provider_freshness"),
    ("finalThequeMovies", "tmdb_id", "tmdb_id,en_poster,backdrop,provider_freshness"),
    ("finalSoons", "id", "id,en_poster,backdrop,provider_freshness"),
)
TMDB_IMAGE_HOSTS = {"image.tmdb.org"}
TMDB_FILE = re.compile(r"^/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
APP_IMAGE_URL = re.compile(r"^/api/images/v1/(poster|backdrop)/([a-f0-9]{64})/(\d+)\.webp$")
ART_OBJECT_KEY = re.compile(r"^artwork/v1/(poster|backdrop)/[a-f0-9]{64}/(complete|([0-9]+)\.webp)$")


def is_production(url: str) -> bool:
    return urlsplit(url).hostname == f"{PRODUCTION_PROJECT_REF}.supabase.co"


def tmdb_path(value):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or parsed.hostname not in TMDB_IMAGE_HOSTS
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return None
    parts = parsed.path.split("/")
    if len(parts) != 5 or parts[1:3] != ["t", "p"] or not re.fullmatch(r"(?:w\d+|original)", parts[3]):
        return None
    candidate = "/" + parts[4]
    return candidate if TMDB_FILE.fullmatch(candidate) else None


def image_references(value, kind):
    if not isinstance(value, str):
        return set()
    path = urlsplit(value).path
    match = APP_IMAGE_URL.fullmatch(path)
    if not match or match.group(1) != kind:
        return set()
    return {f"artwork/v1/{kind}/{match.group(2)}/{width}.webp" for width in VARIANTS[kind]}


def build_clients(*, require_storage=True):
    from supabase import create_client

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    storage = ArtworkStorage.from_environment()
    if require_storage and storage is None:
        raise RuntimeError("Set all R2 configuration variables before running artwork tooling")
    return create_client(supabase_url, service_key), storage


def each_row(client, table, columns, page_size=200, *, lease_guard=None):
    offset = 0
    while True:
        if lease_guard:
            lease_guard()
        response = client.table(table).select(columns).order(columns.split(",")[0]).range(offset, offset + page_size - 1).execute()
        rows = getattr(response, "data", None)
        expected_columns = tuple(column.strip() for column in columns.split(","))
        if not isinstance(rows, list):
            raise RuntimeError(f"Supabase scan for {table} returned incomplete row data")
        if any(
            not isinstance(row, dict) or any(column not in row for column in expected_columns)
            for row in rows
        ):
            raise RuntimeError(f"Supabase scan for {table} returned malformed or incomplete rows")
        yield from rows
        if len(rows) < page_size:
            break
        offset += len(rows)


def _catalog_rows(client, table, columns, lease_guard=None):
    if lease_guard:
        yield from each_row(client, table, columns, lease_guard=lease_guard)
    else:
        yield from each_row(client, table, columns)


def run_backfill(client, storage, *, apply: bool, limit: int | None = None, lease_guard=None):
    counts = {"scanned": 0, "updated": 0, "unchanged": 0, "failed": 0}
    for table, primary_key, columns in TABLES:
        for row in _catalog_rows(client, table, columns, lease_guard):
            if lease_guard:
                lease_guard()
            if limit is not None and counts["scanned"] >= limit:
                return counts
            counts["scanned"] += 1
            new = {}
            for field, kind in (("en_poster", "poster"), ("backdrop", "backdrop")):
                source = tmdb_path(row.get(field))
                if source:
                    new[field] = source
            if not new:
                counts["unchanged"] += 1
                continue
            if apply:
                candidate_paths = new
                new = {}
                failed = False
                updated_row = {"provider_freshness": deepcopy(row.get("provider_freshness") or {})}
                for field, kind in (("en_poster", "poster"), ("backdrop", "backdrop")):
                    source = candidate_paths.get(field)
                    if not source:
                        continue
                    try:
                        if lease_guard:
                            lease_guard()
                        result = storage.store(kind, source)
                        ArtworkStorage.record_metadata(updated_row, kind, result)
                        new[field] = result.url
                    except Exception as error:
                        from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                        if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
                            raise
                        logging.warning("Artwork backfill failed for %s %s (%s)", table, kind, type(error).__name__)
                        failed = True
                if failed:
                    counts["failed"] += 1
                if not new:
                    continue
                new["provider_freshness"] = updated_row["provider_freshness"]
                if lease_guard:
                    lease_guard()
                saved = client.table(table).update(new).eq(primary_key, row[primary_key]).select(primary_key).execute().data or []
                if len(saved) != 1:
                    raise RuntimeError(f"Expected one updated row in {table}")
            counts["updated"] += 1
    return counts


def run_rollback(client, *, apply: bool, limit: int | None = None, lease_guard=None):
    """Restore only images with saved TMDB source paths; retain metadata for retries."""
    counts = {"scanned": 0, "restored": 0, "unchanged": 0}
    for table, primary_key, columns in TABLES:
        for row in _catalog_rows(client, table, columns, lease_guard):
            if lease_guard:
                lease_guard()
            if limit is not None and counts["scanned"] >= limit:
                return counts
            counts["scanned"] += 1
            artwork = (row.get("provider_freshness") or {}).get("artwork") or {}
            new = {}
            for field, kind, tmdb_size in (
                ("en_poster", "poster", "w342"),
                ("backdrop", "backdrop", "w1280"),
            ):
                record = artwork.get(kind) or {}
                source = record.get("source_path")
                if (
                    not APP_IMAGE_URL.fullmatch(urlsplit(row.get(field) or "").path)
                    or record.get("processing_version") != "v1"
                    or not isinstance(source, str)
                    or not TMDB_FILE.fullmatch(source)
                ):
                    continue
                new[field] = f"https://image.tmdb.org/t/p/{tmdb_size}{source}"
            if not new:
                counts["unchanged"] += 1
                continue
            if apply:
                if lease_guard:
                    lease_guard()
                saved = client.table(table).update(new).eq(primary_key, row[primary_key]).select(primary_key).execute().data or []
                if len(saved) != 1:
                    raise RuntimeError(f"Expected one rolled-back row in {table}")
            counts["restored"] += 1
    return counts


def referenced_keys(client, *, lease_guard=None):
    keys = set()
    for table, _primary, columns in TABLES:
        for row in _catalog_rows(client, table, columns, lease_guard):
            for field, kind in (("en_poster", "poster"), ("backdrop", "backdrop")):
                value = row.get(field)
                if value in (None, ""):
                    continue
                if not isinstance(value, str):
                    raise RuntimeError(f"Artwork reference scan found malformed {table}.{field} data")
                path = urlsplit(value).path
                match = APP_IMAGE_URL.fullmatch(path)
                if match:
                    if match.group(1) != kind:
                        raise RuntimeError(f"Artwork reference scan found a mismatched {table}.{field} kind")
                    if int(match.group(3)) not in VARIANTS[kind]:
                        raise RuntimeError(f"Artwork reference scan found an unknown {table}.{field} variant")
                    keys.update(image_references(value, kind))
                elif "/api/images/" in path:
                    raise RuntimeError(f"Artwork reference scan found a malformed R2 URL in {table}.{field}")
    return keys


def ensure_no_active_pipeline(client):
    result = client.table("utilRunLogs").select("run_id").eq("running_now", True).limit(1).execute()
    if result.data:
        raise RuntimeError("Cleanup refused while a dataflow run is active")


def run_cleanup(client, storage, *, apply: bool, grace_days=30, lease_guard=None, max_deletes=500) -> dict[str, object]:
    """Plan or delete old unreferenced variants; caller must hold the D1 lease."""
    if grace_days < 0 or max_deletes < 1:
        raise ValueError("Cleanup grace period and deletion bound must be non-negative/positive")
    if lease_guard:
        lease_guard()
    live = referenced_keys(client, lease_guard=lease_guard)
    cutoff = datetime.now(timezone.utc) - timedelta(days=grace_days)
    eligible = 0
    candidates = []
    paginator = storage.client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=storage.bucket, Prefix="artwork/v1/"):
        if lease_guard:
            lease_guard()
        contents = page.get("Contents", [])
        if not isinstance(contents, list):
            raise RuntimeError("Artwork R2 listing returned malformed object data; no deletion was attempted")
        for obj in contents:
            if not isinstance(obj, dict):
                raise RuntimeError("Artwork R2 listing returned malformed object data; no deletion was attempted")
            key, modified = obj.get("Key"), obj.get("LastModified")
            if not isinstance(key, str) or not key.startswith("artwork/v1/") or not isinstance(modified, datetime):
                raise RuntimeError("Artwork R2 listing was incomplete or malformed; no deletion was attempted")
            object_match = ART_OBJECT_KEY.fullmatch(key)
            if not object_match or (
                object_match.group(2) != "complete"
                and int(object_match.group(3)) not in VARIANTS[object_match.group(1)]
            ):
                raise RuntimeError("Artwork R2 listing contains an unknown object key; no deletion was attempted")
            if modified.tzinfo is None:
                modified = modified.replace(tzinfo=timezone.utc)
            if key in live or modified > cutoff:
                continue
            # A completion marker belongs to a set; retain it while any output
            # from that set is still referenced.
            prefix = key.rsplit("/", 1)[0] + "/"
            if any(ref.startswith(prefix) for ref in live):
                continue
            eligible += 1
            if len(candidates) < max_deletes:
                candidates.append(key)
    deleted = 0
    if apply and candidates:
        from backend.utils.log.shared_cleanup import verify_lease
        verify_lease(lease_guard)
        response = storage.client.delete_objects(
            Bucket=storage.bucket,
            Delete={"Objects": [{"Key": key} for key in candidates], "Quiet": True},
        )
        if response.get("Errors"):
            raise RuntimeError("Artwork R2 cleanup did not confirm every deletion")
        deleted = len(candidates)
    return {
        "live_variants": len(live),
        "eligible_objects": eligible,
        "deletion_batch": len(candidates),
        "sample_keys": candidates[:20],
        "deleted": deleted,
    }


def main():
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), default=os.environ.get("KARTISERET_TARGET"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--backfill", action="store_true", help="Copy artwork; dry-run unless --apply is also set")
    mode.add_argument("--rollback", action="store_true", help="Restore published R2 URLs to their saved TMDB source paths")
    mode.add_argument("--cleanup", action="store_true", help="Find or remove old unreferenced artwork; shared cleanup coordinates the lease")
    parser.add_argument("--apply", action="store_true", help="Apply database updates or object deletions")
    parser.add_argument("--allow-production", action="store_true", help="Explicitly permit an apply operation against production")
    parser.add_argument("--limit", type=int, help="Limit number of catalog rows for a test pass")
    args = parser.parse_args()
    if not args.target:
        parser.error("select --target development or --target production")
    selected = resolve_target_environment(args.target, os.environ)
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)
    client, storage = build_clients(require_storage=not args.rollback)
    project_url = os.environ["SUPABASE_URL"].strip()
    if args.allow_production and not args.apply:
        raise RuntimeError("--allow-production requires --apply")
    if args.apply and is_production(project_url) and not args.allow_production:
        raise RuntimeError("Production mutation requires the explicit --allow-production flag")
    def execute(store=None, token=None):
        if store is not None:
            from backend.utils.log.shared_cleanup import lease_renewal_callback

            guard = lease_renewal_callback(store, token)
        else:
            guard = None
        if args.cleanup:
            return run_cleanup(client, storage, apply=args.apply, lease_guard=guard)
        if args.rollback:
            return run_rollback(client, apply=args.apply, limit=args.limit, lease_guard=guard)
        return run_backfill(client, storage, apply=args.apply, limit=args.limit, lease_guard=guard)

    if args.apply or args.cleanup:
        from backend.utils.log.shared_cleanup import maintenance_lease
        with maintenance_lease(skip_if_busy=False) as (store, token):
            result = execute(store, token)
    else:
        result = execute()
    print(result)


if __name__ == "__main__":
    main()
