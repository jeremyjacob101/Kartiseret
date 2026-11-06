from dotenv import load_dotenv

load_dotenv()

import argparse
import json
import os
from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.dataflow.utils.PublicationWorkspace import create_client, atomic_maintenance

from backend.utils.supabase.clear_orphan_final_movies import DELETE_CHUNK_SIZE, select_tmdb_ids


@atomic_maintenance("cinematheques")
def clear_orphan_final_theque_movies(*, apply=True, lease_guard=None):
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    screening_tmdb_ids = select_tmdb_ids(sb, "finalTheques", lease_guard=lease_guard)
    movie_tmdb_ids = select_tmdb_ids(sb, "finalThequeMovies", lease_guard=lease_guard)
    orphan_tmdb_ids = sorted(movie_tmdb_ids - screening_tmdb_ids)

    deleted_count = 0
    for start in range(0, len(orphan_tmdb_ids), DELETE_CHUNK_SIZE):
        chunk = orphan_tmdb_ids[start : start + DELETE_CHUNK_SIZE]
        if apply:
            from backend.utils.log.shared_cleanup import verify_lease
            verify_lease(lease_guard)
            sb.table("finalThequeMovies").delete().in_("tmdb_id", chunk).execute()
        deleted_count += len(chunk)

    return deleted_count


def main():
    parser = argparse.ArgumentParser(description="Run legacy orphan-theque cleanup under the shared target lease.")
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
        print(json.dumps({"orphan_theque_movies": clear_orphan_final_theque_movies(apply=not args.dry_run, lease_guard=guard)}))


if __name__ == "__main__":
    from backend.utils.log.job_lease import run_cli
    raise SystemExit(run_cli(main, "backend.utils.supabase.clear_orphan_final_theque_movies"))
