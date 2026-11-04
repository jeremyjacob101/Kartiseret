"""Bounded best-effort finalization after a supervised worker was terminated."""

from __future__ import annotations

import argparse
import os
import sys

from supabase import create_client

from backend.utils.log.cloudflare_storage import write_recovery_envelope
from backend.utils.log.run_storage import RunArtifactStore


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True, type=int)
    parser.add_argument("--elapsed-seconds", required=True, type=float)
    args = parser.parse_args()

    errors = []
    supabase_confirmed = False
    try:
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        response = client.table("utilRunLogs").update({
            "successful": False,
            "total_time": max(0.0, args.elapsed_seconds),
            "running_now": False,
        }).eq("run_id", args.run_id).execute()
        if not (response.data or []):
            raise RuntimeError("Supabase did not confirm the interrupted run update")
        supabase_confirmed = True
    except Exception as error:
        errors.append(f"Supabase:{type(error).__name__}")

    try:
        store = RunArtifactStore()
        if supabase_confirmed:
            store.mark_run_failed(args.run_id, reason="supervisor_interrupted")
        else:
            store.mark_run_unconfirmed(args.run_id, reason="supabase_finalization_unconfirmed")
        store.d1.check_storage()
    except Exception as error:
        errors.append(f"Cloudflare:{type(error).__name__}")

    if errors:
        write_recovery_envelope(
            "run_finalization", str(args.run_id),
            {
                "run_id": args.run_id,
                "status": "unconfirmed",
                "supabase_confirmed": supabase_confirmed,
                "errors": errors,
            },
        )
        print(
            f"Could not confirm finalization for run {args.run_id}: {', '.join(errors)}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
