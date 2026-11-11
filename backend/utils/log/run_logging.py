from backend.utils.log.job_lease import create_client
from typing import Any, Callable
from datetime import datetime
from zoneinfo import ZoneInfo
import os, time

from backend.utils.log.cloudflare_storage import write_recovery_envelope
from backend.utils.log.cloudflare_storage import CloudflareStorageError
from backend.utils.log.run_storage import RunArtifactStore

CURRENT_RUN_ID: int | None = None
CURRENT_RUN_LEASE_TOKEN: str | None = None
CURRENT_RUN_STORE: RunArtifactStore | None = None
RUN_LOCK_SLEEP_SECONDS = int(os.environ.get("RUN_LOCK_SLEEP_SECONDS", "600"))
RUN_LOCK_MAX_WAIT_SECONDS = int(os.environ.get("RUN_LOCK_MAX_WAIT_SECONDS", "10800"))
ISRAEL_TIMEZONE = ZoneInfo("Asia/Jerusalem")


def israel_local_timestamp() -> str:
    """Return the current time with Israel's DST-aware UTC offset."""
    return datetime.now(ISRAEL_TIMEZONE).isoformat()


def _clear_current_run_context(run_id: int) -> None:
    global CURRENT_RUN_ID, CURRENT_RUN_LEASE_TOKEN, CURRENT_RUN_STORE
    if CURRENT_RUN_ID == run_id:
        CURRENT_RUN_ID = None
        CURRENT_RUN_LEASE_TOKEN = None
        CURRENT_RUN_STORE = None


def allocate_run_id(on_allocated: Callable[[int], None] | None = None) -> int:
    target = os.environ.get("KARTISERET_TARGET", "").strip()
    from backend.config.target_environment import resolve_target_environment

    if target not in {"development", "production"}:
        raise RuntimeError("KARTISERET_TARGET must select development or production before a run starts")
    resolve_target_environment(target, os.environ)
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    storage = RunArtifactStore()
    storage.ensure_schema()
    lease_token: str | None = None
    new_id: int | None = None
    inserted = False
    d1_started = False

    run_from_override = (os.environ.get("RUN_FROM_OVERRIDE") or "").strip()
    if run_from_override:
        run_from = run_from_override
    elif os.environ.get("JJ_INTEL_MAC_DAILY_RUN") == "true":
        run_from = "JJ_INTEL_MAC_DAILY_RUN"
    elif os.environ.get("JJ_INTEL_MAC_WEEKLY_RUN") == "true":
        run_from = "JJ_INTEL_MAC_WEEKLY_RUN"
    elif os.environ.get("GITHUB_ACTIONS") == "true":
        run_from = "GITHUB_ACTIONS"
    else:
        run_from = os.environ.get("RUNNER_MACHINE") or "unknown"

    sleep_seconds = max(1, RUN_LOCK_SLEEP_SECONDS)
    max_wait_seconds = max(0, RUN_LOCK_MAX_WAIT_SECONDS)
    deadline = time.monotonic() + max_wait_seconds
    attempts = max(1, max_wait_seconds // sleep_seconds)

    def wait_for_lease(reason: str) -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f"run cannot start; bounded wait expired while {reason}")
        print(f"WAITING WHILE {reason.upper()}")
        time.sleep(min(float(sleep_seconds), remaining))

    try:
        # The target-specific D1 lease serializes local pipelines with scheduled
        # maintenance across hosts. Wait using the same bounded policy already
        # used for a running Supabase run ID.
        for lock_attempt in range(attempts):
            try:
                lease_token = storage.acquire_run_lease()
                break
            except CloudflareStorageError as error:
                if "Another scraper run holds the D1 run lease" not in str(error) or lock_attempt + 1 >= attempts:
                    raise
                wait_for_lease("waiting for the selected target's D1 lease")
        else:
            raise RuntimeError("run cannot start because the selected target's D1 lease remained held")
        from backend.utils.log.job_lease import reconcile_predecessor
        reconcile_predecessor(storage)
        while True:
            rows = sb.table("utilRunLogs").select("run_id").eq("running_now", True).limit(1).execute().data
            if not rows:
                break
            wait_for_lease("waiting for utilRunLogs to finish its active run")

        rows = sb.table("utilRunLogs").select("run_id").order("run_id", desc=True).limit(1).execute().data
        new_id = int(rows[0]["run_id"]) + 1
        storage.attach_run_id_to_lease(lease_token, new_id)
        if on_allocated is not None:
            on_allocated(new_id)
        sb.table("utilRunLogs").insert({
            "run_id": new_id,
            "running_now": True,
            "successful": None,
            "run_from": run_from,
            "date_created": israel_local_timestamp(),
        }).execute()
        inserted = True
        storage.start_run(run_id=new_id, target=os.environ.get("KARTISERET_TARGET", ""), run_from=run_from)
        d1_started = True
        from backend.utils.log.shared_cleanup import run_pipeline_preflight

        run_pipeline_preflight(storage, lease_token=lease_token)
    except Exception as error:
        if inserted and new_id is not None:
            if d1_started:
                try:
                    storage.finalize_run(
                        run_id=new_id,
                        successful=False,
                        total_time=0.0,
                        selected_runners=[],
                        error_type=type(error).__name__,
                    )
                except Exception:
                    write_recovery_envelope(
                        "run_finalization", str(new_id),
                        {"run_id": new_id, "status": "unconfirmed", "error_type": type(error).__name__},
                    )
            try:
                response = sb.table("utilRunLogs").update({
                    "successful": False, "running_now": False, "total_time": 0.0,
                }).eq("run_id", int(new_id)).execute()
                if not (response.data or []):
                    raise RuntimeError("Supabase did not confirm run allocation failure finalization")
            except Exception:
                write_recovery_envelope(
                    "run_finalization",
                    str(new_id),
                    {"run_id": new_id, "status": "unconfirmed", "error_type": type(error).__name__},
                )
        if lease_token:
            try:
                storage.release_run_lease(token=lease_token, reconcile_run_id=new_id)
            except Exception:
                pass
        try:
            from backend.utils.log.shared_cleanup import _print_r2_budget_summary

            _print_r2_budget_summary()
        except Exception:
            pass
        raise

    global CURRENT_RUN_ID, CURRENT_RUN_LEASE_TOKEN, CURRENT_RUN_STORE
    CURRENT_RUN_ID = new_id
    CURRENT_RUN_LEASE_TOKEN = lease_token
    CURRENT_RUN_STORE = storage
    return new_id


class RunLogSession:
    def __init__(self, on_allocated: Callable[[int], None] | None = None) -> None:
        self.run_id: int | None = None
        self._start_time: float = 0.0
        self._selected_runners: list[dict[str, Any]] = []
        self._successful: bool = True
        self._on_allocated = on_allocated
        self._storage: RunArtifactStore | None = None
        self._error_type: str | None = None
        self._lease_released = False
        self._lease_token: str | None = None

    def __enter__(self) -> "RunLogSession":
        from backend.utils.log.r2_budget import R2Budget
        R2Budget.create_job_budget()
        try:
            self._start_time = float(os.environ.get("KARTISERET_JOB_STARTED_MONOTONIC", time.monotonic()))
        except (TypeError, ValueError):
            self._start_time = time.monotonic()
        self.run_id = allocate_run_id(on_allocated=self._on_allocated)
        self._storage = CURRENT_RUN_STORE
        self._lease_token = CURRENT_RUN_LEASE_TOKEN
        self._selected_runners = []
        self._successful = True
        return self

    def set_successful(self, ok: bool) -> None:
        self._successful = self._successful and bool(ok)

    def set_plan(self, plan: list[tuple]) -> None:
        out: list[dict[str, Any]] = []

        for entry in plan or []:
            if not isinstance(entry, tuple):
                continue
            if len(entry) == 2:
                kind, key = entry
                out.append({"kind": str(kind), "key": str(key)})
                continue
            if len(entry) == 3:
                kind, key, classes_override = entry
                class_names: list[str] = []
                if classes_override:
                    try:
                        class_names = [c.__name__ for c in classes_override]
                    except Exception:
                        class_names = []
                out.append({"kind": str(kind), "key": str(key), "classes_override": class_names})
                continue
            out.append({"raw_entry": repr(entry)})

        self._selected_runners = out

    def run_groups(self, plan: list[tuple], *, run_group_fn: Callable[..., bool]) -> bool:
        self.set_plan(plan)

        overall_ok = True
        for entry in plan or []:
            if len(entry) == 2:
                kind, key = entry
                ok = bool(run_group_fn(kind, key, self.run_id))
            else:
                kind, key, classes_override = entry
                ok = bool(run_group_fn(kind, key, self.run_id, classes_override=classes_override))

            overall_ok = overall_ok and ok

        self.set_successful(overall_ok)
        return overall_ok

    def __exit__(self, exc_type, exc, tb) -> bool:
        if self.run_id is None:
            return False

        from rich.console import Console
        from backend.utils.console.stage_progress import render_key_value_table
        from backend.utils.console.stage_progress import TimedStageProgress
        from backend.utils.log.r2_budget import R2Budget

        console = Console()
        progress = TimedStageProgress("RunFinalization", "Finalize run status and logs", console)
        summary: dict[str, Any] = {
            "Run ID": self.run_id,
            "Target": os.environ.get("KARTISERET_TARGET", "—"),
            "Outcome": "Successful" if self._successful and exc_type is None else "Failed",
            "Log/status": "Pending",
            "Storage check": "Pending",
            "Lease": "Pending",
            "R2 budget": "Unavailable",
        }
        try:
            budget = R2Budget.from_environment()
            if budget is not None:
                counts = budget.snapshot()
                summary["R2 budget"] = (
                    f"Class A {counts['class_a']}/{budget.class_a_limit} · "
                    f"Class B {counts['class_b']}/{budget.class_b_limit} · "
                    f"tripped={counts['tripped'] or 'no'}"
                )
        except Exception:
            pass

        progress.__enter__()
        try:
            result = self._finalize_session(exc_type, exc, tb, progress, summary)
            elapsed = progress.finish("Confirmed")
            summary["Elapsed"] = f"{elapsed:.1f}s"
            return result
        except BaseException:
            if progress.state == "running":
                elapsed = progress.finish("Failed or unconfirmed", successful=False)
                summary["Elapsed"] = f"{elapsed:.1f}s"
            if summary["Log/status"] == "Pending":
                summary["Log/status"] = "Failed or unconfirmed"
            if summary["Storage check"] == "Pending":
                summary["Storage check"] = "Not confirmed"
            if summary["Lease"] == "Pending":
                summary["Lease"] = "Not confirmed"
            summary["Outcome"] = "Finalization failed or unconfirmed"
            raise
        finally:
            progress.close()
            render_key_value_table("Run finalization", list(summary.items()), console, status="failed" if "failed" in str(summary["Outcome"]).lower() else None)

    def _finalize_session(self, exc_type, exc, tb, progress, summary: dict[str, Any]) -> bool:
        if exc_type is not None:
            self._successful = False

        if self.run_id is not None:
            total_time = max(0.0, time.monotonic() - self._start_time)
            if exc_type is not None:
                self._error_type = getattr(exc_type, "__name__", "Exception")
            storage = self._storage or RunArtifactStore()
            sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
            storage_error: Exception | None = None
            post_storage_error: Exception | None = None
            post_storage_confirmed = False
            supabase_finalized = False
            progress.advance(0.18, "Writing run artifacts")
            try:
                storage.finalize_run(
                    run_id=int(self.run_id), successful=bool(self._successful),
                    total_time=total_time, selected_runners=self._selected_runners,
                    error_type=self._error_type,
                )
            except Exception as error:
                storage_error = error
                self._successful = False
                write_recovery_envelope(
                    "run_finalization", str(self.run_id),
                    {"run_id": self.run_id, "status": "failed", "error_type": type(error).__name__},
                )

            progress.advance(0.36, "Confirming run status")
            try:
                response = sb.table("utilRunLogs").update({
                    "selected_runners": self._selected_runners,
                    "successful": bool(self._successful),
                    "total_time": float(total_time),
                    "running_now": False,
                }).eq("run_id", int(self.run_id)).execute()
                if not (response.data or []):
                    raise RuntimeError(f"Supabase did not confirm finalization for run {self.run_id}.")
                supabase_finalized = True
                summary["Log/status"] = "Confirmed in Supabase" if storage_error is None else "Supabase confirmed · D1 log failed"
            except Exception as error:
                summary["Log/status"] = "Unconfirmed in Supabase"
                write_recovery_envelope(
                    "run_finalization", str(self.run_id),
                    {"run_id": self.run_id, "status": "unconfirmed", "error_type": type(error).__name__},
                )
                try:
                    storage.mark_run_unconfirmed(int(self.run_id), type(error).__name__, release_lease=False)
                except Exception:
                    pass
                raise RuntimeError(
                    f"Run {self.run_id} finalization is unconfirmed in Supabase; inspect local recovery files."
                ) from error
            finally:
                if supabase_finalized and storage_error is None:
                    from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                    budget_failure = bool(
                        exc_type and issubclass(exc_type, (R2BudgetError, R2BudgetExceeded))
                    )
                    if budget_failure:
                        progress.advance(0.62, "Checking D1 storage size")
                        try:
                            # Keep the post-run D1 size check without issuing
                            # another R2 request after the job budget tripped.
                            storage.d1.measure_database_size()
                            summary["Storage check"] = "D1 size measured · R2 check skipped (budget limit)"
                        except Exception as error:
                            summary["Storage check"] = f"Unavailable ({type(error).__name__})"
                    else:
                        progress.advance(0.62, "Checking storage")
                        try:
                            storage.check_storage(lease_token=self._lease_token)
                            summary["Storage check"] = "Passed"
                        except Exception as error:
                            post_storage_error = error
                            summary["Storage check"] = f"Failed ({type(error).__name__})"
                            confirmed = False
                            try:
                                response = sb.table("utilRunLogs").update({"successful": False}).eq("run_id", int(self.run_id)).execute()
                                confirmed = bool(response.data or [])
                            except Exception:
                                pass
                            post_storage_confirmed = confirmed
                            write_recovery_envelope(
                                "run_finalization", str(self.run_id),
                                {"run_id": self.run_id, "status": "failed" if confirmed else "unconfirmed",
                                 "reason": "storage_check_failed", "error_type": type(error).__name__},
                            )
                            try:
                                if confirmed:
                                    storage.finalize_run(
                                        run_id=int(self.run_id), successful=False,
                                        total_time=total_time, selected_runners=self._selected_runners,
                                        error_type="storage_check_failed",
                                    )
                                else:
                                    storage.mark_run_unconfirmed(
                                        int(self.run_id), reason="supabase_finalization_unconfirmed",
                                        release_lease=False,
                                    )
                            except Exception:
                                pass
                elif storage_error is not None:
                    summary["Storage check"] = "Skipped (run artifact log failed)"
                progress.advance(0.86, "Releasing target lease")
                try:
                    # Persist the confirmed log/storage phase while ownership is
                    # still active. Lease release retires every guarded writer.
                    if supabase_finalized and storage_error is None and post_storage_error is None and exc_type is None:
                        from backend.utils.console.stage_progress import record_stage_duration

                        record_stage_duration(
                            "RunFinalization",
                            max(0.0, time.monotonic() - progress.started_at),
                            progress.weekday,
                        )
                    if supabase_finalized:
                        storage.release_run_lease(token=self._lease_token)
                    else:
                        storage.release_run_lease(token=self._lease_token, reconcile_run_id=int(self.run_id))
                    self._lease_released = True
                    summary["Lease"] = "Released"
                except Exception as error:
                    summary["Lease"] = f"Unconfirmed ({type(error).__name__})"
                    write_recovery_envelope(
                        "run_finalization", str(self.run_id),
                        {"run_id": self.run_id, "status": "unconfirmed", "error_type": type(error).__name__},
                    )
                    try:
                        sb.table("utilRunLogs").update({"successful": False}).eq("run_id", int(self.run_id)).execute()
                    except Exception:
                        pass
                    raise RuntimeError(
                        f"Run {self.run_id} status was marked unsuccessful because its D1 lease could not be released."
                    ) from error
                finally:
                    _clear_current_run_context(int(self.run_id))
            if storage_error is not None:
                summary["Outcome"] = "Failed · D1 log finalization failed"
                raise RuntimeError(
                    f"Run {self.run_id} was marked unsuccessful because D1 finalization failed."
                ) from storage_error
            if post_storage_error is not None:
                summary["Outcome"] = "Failed · storage check failed"
                from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                if isinstance(post_storage_error, (R2BudgetError, R2BudgetExceeded)):
                    raise post_storage_error
                status = "failed" if post_storage_confirmed else "unconfirmed"
                raise RuntimeError(f"Run {self.run_id} completed, but its D1 storage check failed; status is {status}.") from post_storage_error

            summary["Outcome"] = "Successful" if self._successful else "Run completed with failures"

        return False
