"""Explicitly recover a target lock after its owner and descendants are stopped."""
from __future__ import annotations

import argparse
import os

from backend.utils.log.cloudflare_storage import CloudflareStorageError


def recover_lock(store, client, *, expected_token: str, owner_stopped: bool) -> None:
    if not owner_stopped or not expected_token:
        raise ValueError("Confirm the owner and all child processes are stopped and supply its exact token")
    rows = store.d1.execute("SELECT lease_token, run_id FROM run_locks WHERE id = 1").rows
    if len(rows) != 1 or rows[0].get("lease_token") != expected_token:
        raise CloudflareStorageError("Lock ownership changed; recovery refused")
    run_id = rows[0].get("run_id")
    if run_id is not None:
        result = client.table("utilRunLogs").update({
            "successful": False, "running_now": False,
        }).eq("run_id", int(run_id)).execute()
        if not result.data:
            raise CloudflareStorageError("Supabase did not confirm recovery; lock retained")
        store.mark_run_unconfirmed(int(run_id), "operator_confirmed_owner_stopped", release_lease=False)
    # Compare the original token again atomically; never clear a new owner's lock.
    store.release_run_lease(token=expected_token)


def main() -> None:
    from dotenv import load_dotenv
    from supabase import create_client
    from backend.utils.log.shared_cleanup import _load_target
    from backend.utils.log.run_storage import RunArtifactStore

    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--expected-token", required=True)
    parser.add_argument("--confirm-owner-stopped", action="store_true", required=True)
    args = parser.parse_args()
    _load_target(args.target)
    store = RunArtifactStore()
    store.ensure_schema()
    recover_lock(store, create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]),
                 expected_token=args.expected_token, owner_stopped=args.confirm_owner_stopped)
    print(f"Recovered {args.target} lock; interrupted run remains unconfirmed in D1")


if __name__ == "__main__":
    main()
