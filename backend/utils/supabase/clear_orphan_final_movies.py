from dotenv import load_dotenv

load_dotenv()

import argparse
import json
from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.dataflow.utils.PublicationWorkspace import create_client, atomic_maintenance
import os

PAGE_SIZE = 500
DELETE_CHUNK_SIZE = 200


def select_tmdb_ids(sb, table_name, page_size=PAGE_SIZE, *, lease_guard=None):
    tmdb_ids = set()
    start = 0

    while True:
        if lease_guard:
            lease_guard()
        response = sb.table(table_name).select("tmdb_id").range(start, start + page_size - 1).execute()
        rows = getattr(response, "data", None)
        if not isinstance(rows, list) or any(
            not isinstance(row, dict)
            or "tmdb_id" not in row
            or isinstance(row.get("tmdb_id"), bool)
            or not isinstance(row.get("tmdb_id"), (str, int))
            or (isinstance(row.get("tmdb_id"), str) and not row["tmdb_id"].strip())
            for row in rows
        ):
            raise RuntimeError(f"Supabase reference scan for {table_name} was incomplete or malformed; no deletion was attempted")
        if not rows:
            break

        for row in rows:
            tmdb_id = row.get("tmdb_id")
            tmdb_ids.add(tmdb_id)

        if len(rows) < page_size:
            break
        start += page_size

    return tmdb_ids


@atomic_maintenance("nowplayings")
def clear_orphan_final_movies(*, apply=True, lease_guard=None):
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    showtime_tmdb_ids = select_tmdb_ids(sb, "finalShowtimes", lease_guard=lease_guard)
    final_movie_tmdb_ids = select_tmdb_ids(sb, "finalMovies", lease_guard=lease_guard)
    orphan_tmdb_ids = sorted(final_movie_tmdb_ids - showtime_tmdb_ids)

    deleted_count = 0
    for start in range(0, len(orphan_tmdb_ids), DELETE_CHUNK_SIZE):
        chunk = orphan_tmdb_ids[start : start + DELETE_CHUNK_SIZE]
        if apply:
            from backend.utils.log.shared_cleanup import verify_lease
            verify_lease(lease_guard)
            sb.table("finalMovies").delete().in_("tmdb_id", chunk).execute()
        deleted_count += len(chunk)

    return deleted_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run legacy orphan-movie cleanup under the shared target lease.")
    parser.add_argument("--target", choices=("development", "production"), default=os.environ.get("KARTISERET_TARGET"), required=not bool(os.environ.get("KARTISERET_TARGET")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    selected = resolve_target_environment(args.target, os.environ)
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)
    from backend.utils.log.shared_cleanup import lease_renewal_callback, maintenance_lease
    with maintenance_lease(skip_if_busy=False) as (store, token):
        guard = lease_renewal_callback(store, token)
        print(json.dumps({"orphan_movies": clear_orphan_final_movies(apply=not args.dry_run, lease_guard=guard)}))
