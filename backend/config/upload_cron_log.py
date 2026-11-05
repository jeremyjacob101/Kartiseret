"""Store one completed cron transcript in D1."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from dotenv import load_dotenv
from supabase import create_client

from backend.config.target_environment import resolve_target_environment
from backend.utils.log.cloudflare_storage import write_recovery_envelope
from backend.utils.log.run_storage import RunArtifactStore


def _select_profile(target: str) -> None:
    selected = resolve_target_environment(target, os.environ)
    for key in list(os.environ):
        if key.startswith(("DEV_", "PROD_")):
            os.environ[key] = ""
    os.environ.update(selected)


def _mark_supabase_run_failed(run_id: int) -> None:
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    response = client.table("utilRunLogs").update({
        "successful": False, "running_now": False,
    }).eq("run_id", run_id).execute()
    if not (response.data or []):
        raise RuntimeError(f"Supabase did not confirm failure finalization for run {run_id}.")


def _write_finalization_recovery(run_id: int, payload: dict) -> None:
    try:
        write_recovery_envelope("run_finalization", str(run_id), payload)
    except Exception as error:
        print(
            f"Could not persist local run {run_id} finalization recovery ({type(error).__name__}).",
            file=sys.stderr,
        )


def _record_storage_failure(store: RunArtifactStore, run_id: int, reason: str, storage_error: Exception) -> bool:
    """Return whether Supabase confirmed failed status; report uncertainty explicitly."""
    errors = [f"ArtifactStorage:{type(storage_error).__name__}"]
    supabase_confirmed = False
    try:
        _mark_supabase_run_failed(run_id)
        supabase_confirmed = True
    except Exception as error:
        errors.append(f"Supabase:{type(error).__name__}")

    try:
        if supabase_confirmed:
            store.mark_run_failed(run_id, reason=reason)
        else:
            store.mark_run_unconfirmed(run_id, reason="supabase_finalization_unconfirmed")
    except Exception as error:
        errors.append(f"Cloudflare:{type(error).__name__}")

    if errors:
        _write_finalization_recovery(
            run_id,
            {
                "run_id": run_id,
                "status": "failed" if supabase_confirmed else "unconfirmed",
                "supabase_confirmed": supabase_confirmed,
                "errors": errors,
            },
        )
    return supabase_confirmed


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--run-id-file", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--mark-failed", action="store_true")
    args = parser.parse_args(argv)
    run_id_path = Path(args.run_id_file)
    log_path = Path(args.path)
    if not run_id_path.exists():
        print(f"No run ID was allocated; cron transcript remains at {log_path}.", file=sys.stderr)
        return 1
    try:
        run_id = int(run_id_path.read_text(encoding="utf-8").strip())
        content = log_path.read_bytes()
    except (OSError, ValueError) as error:
        print(f"Could not read the completed cron transcript ({type(error).__name__}).", file=sys.stderr)
        return 1

    _select_profile(args.target)
    store = RunArtifactStore()
    try:
        from backend.utils.log.shared_cleanup import maintenance_lease

        with maintenance_lease(skip_if_busy=False) as (locked_store, lease_token):
            store = locked_store
            store.save_text_artifact(
                run_id=run_id,
                artifact_type="cron_output",
                name=log_path.name,
                text=content.decode("utf-8", errors="replace"),
                metadata={"target": args.target, "source": "scheduled-shell-runner"},
            )
            store.check_storage(lease_token=lease_token)
    except Exception as error:
        supabase_confirmed = _record_storage_failure(
            store, run_id, f"cron_upload_{type(error).__name__}", error
        )
        state = "failed in Supabase" if supabase_confirmed else "unconfirmed in Supabase"
        print(
            f"Cron output upload failed for run {run_id}; status is {state} and the local recovery copy remains at {log_path} ({type(error).__name__}).",
            file=sys.stderr,
        )
        return 1

    if args.mark_failed:
        supabase_confirmed = False
        errors = []
        try:
            _mark_supabase_run_failed(run_id)
            supabase_confirmed = True
        except Exception as error:
            errors.append(f"Supabase:{type(error).__name__}")
        try:
            if supabase_confirmed:
                store.mark_run_failed(run_id, reason="cron_output_write_failed")
            else:
                store.mark_run_unconfirmed(run_id, reason="supabase_finalization_unconfirmed")
        except Exception as error:
            errors.append(f"Cloudflare:{type(error).__name__}")
        if errors:
            _write_finalization_recovery(
                run_id,
                {
                    "run_id": run_id,
                    "status": "failed" if supabase_confirmed else "unconfirmed",
                    "supabase_confirmed": supabase_confirmed,
                    "errors": errors,
                },
            )
            state = "failed in Supabase" if supabase_confirmed else "unconfirmed in Supabase"
            print(
                f"Cron transcript was uploaded, but run {run_id} status is {state}.",
                file=sys.stderr,
            )
            return 1

    # This transcript is now safely stored in Cloudflare; remove only the
    # successfully uploaded temporary copy and leave failed uploads untouched.
    try:
        log_path.unlink(missing_ok=True)
        run_id_path.unlink(missing_ok=True)
    except OSError as error:
        print(f"Cloudflare copy is complete; temporary local cleanup failed ({type(error).__name__}).", file=sys.stderr)
    print(f"Uploaded cron transcript for run {run_id} to the selected Cloudflare environment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
