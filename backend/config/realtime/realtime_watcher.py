from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import queue
import signal
import subprocess
import threading
import time
from typing import Any

from dotenv import load_dotenv
from supabase import create_async_client

from backend.config.runners import runGroup
from backend.dataflow.comingsoons.ComingSoonsUpdate import ComingSoonsUpdate
from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate
from backend.utils.log import artifact_logging
from backend.utils.log.run_logging import RunLogSession

load_dotenv()

TABLE_FINAL_MOVIES = "finalMovies"
TABLE_FINAL_SOONS = "finalSoons"
SUPPORTED_TABLES = {TABLE_FINAL_MOVIES, TABLE_FINAL_SOONS}

DEBOUNCE_SECONDS = float(os.environ.get("REALTIME_DEBOUNCE_SECONDS", "8"))
RECONNECT_SECONDS = float(os.environ.get("REALTIME_RECONNECT_SECONDS", "3"))
LOG_LEVEL = os.environ.get("REALTIME_LOG_LEVEL", "INFO").upper()
SOLO_UPDATE_ENV_KEY = "SOLO_UPDATE_ONLY"
RUN_FROM_OVERRIDE_ENV_KEY = "RUN_FROM_OVERRIDE"
REALTIME_GIT_SYNC = str(os.environ.get("REALTIME_GIT_SYNC", "true")).strip().lower() in {"1", "true", "yes", "on"}
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[3]
REALTIME_GIT_SSH_KEY = os.environ.get("REALTIME_GIT_SSH_KEY", "").strip()


def _configure_logging() -> None:
    logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(asctime)s %(levelname)s %(name)s | %(message)s", force=True)


def _run_cmd(args: list[str], *, cwd: pathlib.Path, logger: logging.Logger) -> subprocess.CompletedProcess[str]:
    logger.debug("Running command: %s", " ".join(args))
    env = os.environ.copy()
    if "GIT_SSH_COMMAND" not in env and REALTIME_GIT_SSH_KEY:
        env["GIT_SSH_COMMAND"] = f"ssh -i {REALTIME_GIT_SSH_KEY} " "-o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
    return subprocess.run(args, cwd=str(cwd), env=env, text=True, capture_output=True, check=False)


def _git_sync_before_update(logger: logging.Logger) -> bool:
    if not REALTIME_GIT_SYNC:
        return True

    fetch = _run_cmd(["git", "fetch", "origin", "main"], cwd=PROJECT_ROOT, logger=logger)
    if fetch.returncode != 0:
        logger.error("Git fetch failed before solo update: %s", (fetch.stderr or fetch.stdout).strip())
        return False

    pull = _run_cmd(["git", "pull", "--rebase", "origin", "main"], cwd=PROJECT_ROOT, logger=logger)
    if pull.returncode != 0:
        logger.error("Git pull --rebase failed before solo update: %s", (pull.stderr or pull.stdout).strip())
        return False

    return True


def _git_sync_after_update(logger: logging.Logger, table_name: str) -> bool:
    if not REALTIME_GIT_SYNC:
        return True

    artifact_dir = PROJECT_ROOT / "backend" / "utils" / "log" / "logger_artifacts"
    if artifact_dir.exists():
        add = _run_cmd(["git", "add", str(artifact_dir)], cwd=PROJECT_ROOT, logger=logger)
        if add.returncode != 0:
            logger.error("Git add failed after solo update: %s", (add.stderr or add.stdout).strip())
            return False

    has_staged = _run_cmd(["git", "diff", "--cached", "--quiet"], cwd=PROJECT_ROOT, logger=logger)
    if has_staged.returncode == 0:
        logger.info("No staged artifact changes after %s solo update; skipping commit/push", table_name)
        return True

    commit_msg = f"[RT-SOLO] {table_name} update {time.strftime('%Y-%m-%d_%H-%M-%S')}"
    commit = _run_cmd(["git", "commit", "-m", commit_msg], cwd=PROJECT_ROOT, logger=logger)
    if commit.returncode != 0:
        logger.error("Git commit failed after solo update: %s", (commit.stderr or commit.stdout).strip())
        return False

    fetch = _run_cmd(["git", "fetch", "origin", "main"], cwd=PROJECT_ROOT, logger=logger)
    if fetch.returncode != 0:
        logger.error("Git fetch failed after solo update: %s", (fetch.stderr or fetch.stdout).strip())
        return False

    rebase = _run_cmd(["git", "rebase", "origin/main"], cwd=PROJECT_ROOT, logger=logger)
    if rebase.returncode != 0:
        logger.error("Git rebase failed after solo update: %s", (rebase.stderr or rebase.stdout).strip())
        return False

    push = _run_cmd(["git", "push", "origin", "main"], cwd=PROJECT_ROOT, logger=logger)
    if push.returncode != 0:
        logger.error("Git push failed after solo update: %s", (push.stderr or push.stdout).strip())
        return False

    logger.info("Git sync completed after %s solo update", table_name)
    return True


def _run_single_update(table_name: str) -> bool:
    logger = logging.getLogger("realtime_watcher.git")
    if table_name == TABLE_FINAL_MOVIES:
        plan = [("dataflow", "nowPlayingData", [NowPlayingsUpdate])]
        run_from_override = "np_solo_update"
    elif table_name == TABLE_FINAL_SOONS:
        plan = [("dataflow", "comingSoonsData", [ComingSoonsUpdate])]
        run_from_override = "cs_solo_update"
    else:
        logging.warning("Unknown table trigger ignored: %s", table_name)
        return False

    previous_mode = os.environ.get(SOLO_UPDATE_ENV_KEY)
    previous_run_from = os.environ.get(RUN_FROM_OVERRIDE_ENV_KEY)
    os.environ[SOLO_UPDATE_ENV_KEY] = "true"
    os.environ[RUN_FROM_OVERRIDE_ENV_KEY] = run_from_override
    try:
        if not _git_sync_before_update(logger):
            logger.error("Continuing %s solo update even though pre-run git sync failed", table_name)
        with RunLogSession() as run:
            ok = run.run_groups(plan, run_group_fn=runGroup)
        if ok and not _git_sync_after_update(logger, table_name):
            logger.error("Post-run git sync failed after successful %s solo update", table_name)
        return ok
    finally:
        if previous_mode is None:
            os.environ.pop(SOLO_UPDATE_ENV_KEY, None)
        else:
            os.environ[SOLO_UPDATE_ENV_KEY] = previous_mode
        if previous_run_from is None:
            os.environ.pop(RUN_FROM_OVERRIDE_ENV_KEY, None)
        else:
            os.environ[RUN_FROM_OVERRIDE_ENV_KEY] = previous_run_from


def _worker_loop(event_queue: "queue.Queue[str]", stop_event: threading.Event) -> None:
    logger = logging.getLogger("realtime_watcher.worker")
    pending_deadlines: dict[str, float] = {}

    while not stop_event.is_set():
        now = time.time()
        timeout = 1.0
        if pending_deadlines:
            timeout = max(0.0, min(pending_deadlines.values()) - now)

        try:
            table_name = event_queue.get(timeout=timeout)
            if table_name in SUPPORTED_TABLES:
                pending_deadlines[table_name] = time.time() + DEBOUNCE_SECONDS
                logger.info("Event queued for %s (debounce %.1fs)", table_name, DEBOUNCE_SECONDS)
            else:
                logger.warning("Unsupported event table ignored: %s", table_name)
        except queue.Empty:
            pass

        now = time.time()
        ready_tables = [table for table, deadline in pending_deadlines.items() if deadline <= now]
        for table_name in ready_tables:
            pending_deadlines.pop(table_name, None)
            logger.info("Starting updater for %s", table_name)
            ok = _run_single_update(table_name)
            if ok:
                logger.info("Completed updater for %s successfully", table_name)
            else:
                logger.error("Updater for %s reported failure", table_name)

    logger.info("Worker loop stopped")


async def _subscribe_forever(event_queue: "queue.Queue[str]", stop_event: threading.Event) -> None:
    logger = logging.getLogger("realtime_watcher.listener")
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    while not stop_event.is_set():
        client = None
        channel = None
        try:
            client = await create_async_client(url, key)
            channel_name = f"realtime-watcher-{int(time.time())}"
            channel = client.channel(channel_name)

            def _extract_event_type(payload: Any) -> str:
                if isinstance(payload, dict):
                    if "eventType" in payload:
                        return str(payload.get("eventType"))
                    data = payload.get("data")
                    if isinstance(data, dict) and "type" in data:
                        return str(data.get("type"))
                return "unknown"

            def _payload_requests_solo_update(payload: Any) -> bool:
                if not isinstance(payload, dict):
                    return False
                data = payload.get("data")
                if not isinstance(data, dict):
                    return False
                record = data.get("record")
                if not isinstance(record, dict):
                    return False

                value = record.get("solo_update")
                if isinstance(value, str):
                    return value.strip().lower() in {"1", "true", "yes", "on"}
                return value is True

            def _queue_if_solo_update(table_name: str, payload: Any) -> None:
                event_type = _extract_event_type(payload)
                if not _payload_requests_solo_update(payload):
                    logger.info("Realtime change ignored on %s (event=%s, solo_update is not true)", table_name, event_type)
                    return

                logger.info("Realtime change observed on %s (event=%s, solo_update=true)", table_name, event_type)
                event_queue.put(table_name)

            def on_movies_change(payload: Any) -> None:
                _queue_if_solo_update(TABLE_FINAL_MOVIES, payload)

            def on_soons_change(payload: Any) -> None:
                _queue_if_solo_update(TABLE_FINAL_SOONS, payload)

            def on_subscribe_status(status: Any, err: Any) -> None:
                logger.info("Realtime subscribe status: %s (err=%s)", status, err)

            for event in ("UPDATE", "INSERT", "DELETE"):
                channel.on_postgres_changes(event, on_movies_change, table=TABLE_FINAL_MOVIES, schema="public")
                channel.on_postgres_changes(event, on_soons_change, table=TABLE_FINAL_SOONS, schema="public")

            await client.realtime.connect()
            await channel.subscribe(on_subscribe_status)
            logger.info("Subscribed to realtime changes for public.%s and public.%s", TABLE_FINAL_MOVIES, TABLE_FINAL_SOONS)

            while not stop_event.is_set():
                if not client.realtime.is_connected:
                    raise ConnectionError("Supabase realtime socket disconnected")
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            logger.exception("Realtime subscription loop error (%s). Reconnecting in %.1fs...", exc, RECONNECT_SECONDS)
            await asyncio.sleep(RECONNECT_SECONDS)
        finally:
            try:
                if channel is not None and client is not None:
                    await client.remove_channel(channel)
            except BaseException:
                pass
            try:
                if client is not None:
                    await client.remove_all_channels()
                    await client.realtime.close()
            except BaseException:
                pass

    logger.info("Realtime listener stopped")


def main() -> None:
    artifact_logging.setup_logging()
    _configure_logging()

    event_queue: "queue.Queue[str]" = queue.Queue()
    stop_event = threading.Event()
    worker = threading.Thread(target=_worker_loop, args=(event_queue, stop_event), daemon=True)
    worker.start()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def handle_stop_signal(_signum: int, _frame: Any) -> None:
        logging.getLogger("realtime_watcher").info("Shutdown signal received, stopping...")
        stop_event.set()

    signal.signal(signal.SIGINT, handle_stop_signal)
    signal.signal(signal.SIGTERM, handle_stop_signal)

    try:
        loop.run_until_complete(_subscribe_forever(event_queue, stop_event))
    finally:
        stop_event.set()
        worker.join(timeout=10)
        loop.stop()
        loop.close()


if __name__ == "__main__":
    main()
