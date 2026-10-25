"""Run a pipeline with one wall-clock deadline for its complete process group."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
import selectors
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from backend.config.job_control import CONTROL_FD_ENV


DEFAULT_JOB_SECONDS = 16_200  # 4h 30m, leaving setup and cleanup room in 5-hour Actions jobs.
DEFAULT_SOLO_JOB_SECONDS = 1_800
DEFAULT_TERMINATION_GRACE_SECONDS = 20
FINALIZER_SECONDS = 5
JOB_SECONDS_ENV = "PIPELINE_JOB_DEADLINE_SECONDS"
SOLO_JOB_SECONDS_ENV = "PIPELINE_SOLO_UPDATE_DEADLINE_SECONDS"
GRACE_SECONDS_ENV = "PIPELINE_TERMINATION_GRACE_SECONDS"
ARTIFACT_ROOT = Path("backend/utils/log/logger_artifacts")


@dataclass(frozen=True)
class JobOutcome:
    exit_code: int
    reason: str | None
    run_id: int | None
    successful: bool | None
    elapsed_seconds: float
    remote_finalized: bool | None = None


def configured_seconds(name: str, default: float, *, minimum: float = 0.1) -> float:
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a number of seconds") from error
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f"{name} must be at least {minimum:g} finite seconds")
    return value


def job_seconds(*, solo: bool = False) -> float:
    name, default = (SOLO_JOB_SECONDS_ENV, DEFAULT_SOLO_JOB_SECONDS) if solo else (JOB_SECONDS_ENV, DEFAULT_JOB_SECONDS)
    return configured_seconds(name, default)


def termination_grace_seconds() -> float:
    return configured_seconds(GRACE_SECONDS_ENV, DEFAULT_TERMINATION_GRACE_SECONDS)


def _group_exists(process_group: int) -> bool:
    try:
        os.killpg(process_group, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _signal_group(process_group: int, signum: int, *, leader: subprocess.Popen | None = None) -> None:
    try:
        os.killpg(process_group, signum)
    except (ProcessLookupError, PermissionError):
        # Fall back to the direct child only while it is still our live child.
        if leader is not None and leader.poll() is None:
            try:
                leader.send_signal(signum)
            except ProcessLookupError:
                pass


def _install_signal_handlers(cancel: threading.Event):
    if threading.current_thread() is not threading.main_thread():
        return None
    previous = {}

    def request_cancel(_signum, _frame):
        cancel.set()

    for name in ("SIGINT", "SIGTERM", "SIGHUP"):
        signum = getattr(signal, name, None)
        if signum is not None:
            previous[signum] = signal.getsignal(signum)
            signal.signal(signum, request_cancel)
    return previous


def _restore_signal_handlers(previous) -> None:
    if previous is not None:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def _read_events(fd: int, buffered: bytearray, state: dict) -> bool:
    """Read worker control events; return false after pipe EOF."""
    while True:
        try:
            chunk = os.read(fd, 4096)
        except BlockingIOError:
            return True
        except OSError:
            return False
        if not chunk:
            return False
        buffered.extend(chunk)
        while b"\n" in buffered:
            line, _, remainder = buffered.partition(b"\n")
            buffered[:] = remainder
            try:
                event = json.loads(line)
            except (UnicodeDecodeError, ValueError):
                continue
            if not isinstance(event, dict):
                continue
            if event.get("event") == "run_id":
                try:
                    state["run_id"] = int(event["run_id"])
                except (KeyError, TypeError, ValueError):
                    pass
            elif event.get("event") == "run_complete":
                state["successful"] = bool(event.get("successful"))


def _wait_for_events(selector, fd: int, buffered: bytearray, state: dict, timeout: float) -> bool:
    for key, _mask in selector.select(max(0.0, timeout)):
        if not _read_events(key.fd, buffered, state):
            try:
                selector.unregister(key.fd)
            except (KeyError, ValueError):
                pass
            return False
    return True


def _stop_process_group(child: subprocess.Popen, *, seconds: float, reserve: float, selector, fd: int, buffer: bytearray, state: dict) -> bool:
    """Give the group TERM, then KILL, and reap its leader within the grace."""
    deadline = time.monotonic() + max(0.0, seconds - reserve)
    kill_at = deadline - min(0.5, max(0.0, deadline - time.monotonic()) * 0.1)
    _signal_group(child.pid, signal.SIGTERM, leader=child)
    while (child.poll() is None or _group_exists(child.pid)) and time.monotonic() < kill_at:
        _wait_for_events(selector, fd, buffer, state, min(0.1, kill_at - time.monotonic()))
    if _group_exists(child.pid):
        _signal_group(child.pid, signal.SIGKILL, leader=child)
    while (child.poll() is None or _group_exists(child.pid)) and time.monotonic() < deadline:
        _wait_for_events(selector, fd, buffer, state, min(0.05, deadline - time.monotonic()))
    if child.poll() is None:
        _signal_group(child.pid, signal.SIGKILL, leader=child)
        return False
    child.wait(timeout=0)
    _read_events(fd, buffer, state)
    return not _group_exists(child.pid)


def _record_interrupted_run(run_id: int | None, *, reason: str, started_at: float, root: str) -> None:
    if run_id is None:
        return
    record = {
        "state": reason,
        "elapsed_seconds": max(0.0, time.monotonic() - started_at),
        "remote_write_outcome": "unknown for database requests that were in flight at termination",
    }
    try:
        directory = Path(root) / ARTIFACT_ROOT / str(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / "supervisor-outcome.json.tmp"
        temporary.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, directory / "supervisor-outcome.json")
        (directory / ".job_ok").write_text("false", encoding="utf-8")
    except OSError:
        pass


def _finalize_run_lock(run_id: int, *, started_at: float, seconds: float, cwd: str, env: dict[str, str]) -> bool:
    if seconds <= 0:
        return False
    command = [
        sys.executable,
        "-m",
        "backend.config.supervisor_finalize",
        "--run-id",
        str(run_id),
        "--elapsed-seconds",
        f"{max(0.0, time.monotonic() - started_at):.3f}",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            timeout=seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def run_managed_process(
    command: list[str],
    *,
    seconds: float | None = None,
    grace_seconds: float | None = None,
    env: dict[str, str] | None = None,
    cwd: str | None = None,
    cancel_event: threading.Event | None = None,
) -> JobOutcome:
    """Run one selected job and supervise only its dedicated POSIX process group."""
    if os.name != "posix":
        return JobOutcome(125, "unsupported_platform", None, None, 0.0)
    try:
        limit = float(seconds if seconds is not None else job_seconds())
        grace = float(grace_seconds if grace_seconds is not None else termination_grace_seconds())
    except (TypeError, ValueError) as error:
        print(f"Invalid supervised job budget: {error}", file=sys.stderr, flush=True)
        return JobOutcome(125, "invalid_budget", None, None, 0.0)
    if not math.isfinite(limit) or limit <= 0 or not math.isfinite(grace) or grace < 0:
        return JobOutcome(125, "invalid_budget", None, None, 0.0)

    cancel = cancel_event or threading.Event()
    if cancel.is_set():
        return JobOutcome(130, "cancelled", None, None, 0.0)
    previous_handlers = _install_signal_handlers(cancel)
    started_at = time.monotonic()
    deadline = started_at + limit
    root = str(Path(cwd or os.getcwd()).resolve())
    child_env = os.environ.copy()
    if env:
        child_env.update(env)
    child_env["KARTISERET_JOB_STARTED_MONOTONIC"] = f"{started_at:.9f}"
    child_env["PYTHONUNBUFFERED"] = "1"
    pythonpath = child_env.get("PYTHONPATH", "")
    child_env["PYTHONPATH"] = root + (os.pathsep + pythonpath if pythonpath else "")

    read_fd, write_fd = os.pipe()
    os.set_blocking(read_fd, False)
    child_env[CONTROL_FD_ENV] = str(write_fd)
    selector = selectors.DefaultSelector()
    selector.register(read_fd, selectors.EVENT_READ)
    child = None
    control_open = True
    state = {"run_id": None, "successful": None}
    buffer = bytearray()

    try:
        try:
            child = subprocess.Popen(
                command,
                cwd=root,
                env=child_env,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
                pass_fds=(write_fd,),
            )
        except OSError as error:
            print(f"Could not start supervised job: {error}", file=sys.stderr, flush=True)
            return JobOutcome(125, "startup_failed", None, None, time.monotonic() - started_at)
        finally:
            os.close(write_fd)

        reason = None
        try:
            while child.poll() is None:
                now = time.monotonic()
                if cancel.is_set():
                    reason = "cancelled"
                    break
                if now >= deadline:
                    reason = "deadline_exceeded"
                    break
                if control_open:
                    control_open = _wait_for_events(selector, read_fd, buffer, state, min(0.1, deadline - now))

            _read_events(read_fd, buffer, state)
            if reason is None:
                if _group_exists(child.pid):
                    reason = "owned_processes_remained"
                elif state["successful"] is False:
                    child.wait(timeout=0)
                    return JobOutcome(
                        child.returncode if child.returncode not in (None, 0) else 1,
                        "run_failed",
                        state["run_id"],
                        False,
                        time.monotonic() - started_at,
                    )
                elif child.returncode != 0:
                    reason = "worker_exited_abnormally"
                elif state["successful"] is None:
                    reason = "worker_exited_without_completion"
                else:
                    child.wait(timeout=0)
                    return JobOutcome(child.returncode or 0, None, state["run_id"], state["successful"], time.monotonic() - started_at)
        except KeyboardInterrupt:
            cancel.set()
            reason = "cancelled"
        except Exception as error:
            print(f"Pipeline supervisor failed: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            reason = "supervisor_error"

        stop_started = time.monotonic()
        finalizer_budget = min(FINALIZER_SECONDS, grace * 0.4)
        try:
            reaped = _stop_process_group(
                child,
                seconds=grace,
                reserve=finalizer_budget,
                selector=selector,
                fd=read_fd,
                buffer=buffer,
                state=state,
            )
        except Exception as error:
            print(f"Could not finish worker shutdown cleanly: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            _signal_group(child.pid, signal.SIGKILL, leader=child)
            reaped = child.poll() is not None
        if not reaped and reason != "supervisor_error":
            reason = "child_reap_timeout"

        run_id = state["run_id"]
        _record_interrupted_run(run_id, reason=reason, started_at=started_at, root=root)
        remote_finalized = None
        if run_id is not None:
            remote_finalized = _finalize_run_lock(
                run_id,
                started_at=started_at,
                seconds=min(finalizer_budget, max(0.0, stop_started + grace - time.monotonic())),
                cwd=root,
                env=child_env,
            )

        if reason == "deadline_exceeded":
            exit_code = 124
            print(
                f"Pipeline job deadline exceeded after {limit:.1f}s; its owned process group was terminated. "
                "Database writes already in flight may still commit; their outcome is recorded as unknown.",
                file=sys.stderr,
                flush=True,
            )
        elif reason == "cancelled":
            exit_code = 130
            print(
                "Pipeline job cancelled; its owned process group was terminated. "
                "Database writes already in flight may still commit; their outcome is recorded as unknown.",
                file=sys.stderr,
                flush=True,
            )
        else:
            exit_code = child.returncode if child.returncode not in (None, 0) else 1
            print(f"Supervised worker ended with {reason}; see its supervisor outcome record if a run ID was allocated.", file=sys.stderr, flush=True)
        return JobOutcome(exit_code, reason, run_id, False, time.monotonic() - started_at, remote_finalized)
    finally:
        selector.close()
        for fd in (read_fd, write_fd):
            try:
                os.close(fd)
            except OSError:
                pass
        _restore_signal_handlers(previous_handlers)
