"""Bounded best-effort finalization after a supervised worker was terminated."""

from __future__ import annotations

import argparse
import os

from supabase import create_client


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True, type=int)
    parser.add_argument("--elapsed-seconds", required=True, type=float)
    args = parser.parse_args()

    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    client.table("utilRunLogs").update({
        "successful": False,
        "total_time": max(0.0, args.elapsed_seconds),
        "running_now": False,
    }).eq("run_id", args.run_id).execute()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
