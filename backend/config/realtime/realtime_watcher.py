from __future__ import annotations

import asyncio
import logging
import os
import queue
import signal
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


def _configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
    )


def _run_single_update(table_name: str) -> bool:
    if table_name == TABLE_FINAL_MOVIES:
        plan = [("dataflow", "nowPlayingData", [NowPlayingsUpdate])]
    elif table_name == TABLE_FINAL_SOONS:
        plan = [("dataflow", "comingSoonsData", [ComingSoonsUpdate])]
    else:
        logging.warning("Unknown table trigger ignored: %s", table_name)
        return False

    with RunLogSession() as run:
        return run.run_groups(plan, run_group_fn=runGroup)


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
                logger.info(
                    "Event queued for %s (debounce %.1fs)",
                    table_name,
                    DEBOUNCE_SECONDS,
                )
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

            def on_movies_change(payload: Any) -> None:
                logging.getLogger("realtime_watcher.listener").info(
                    "Realtime change observed on %s (event=%s)",
                    TABLE_FINAL_MOVIES,
                    payload.get("eventType"),
                )
                event_queue.put(TABLE_FINAL_MOVIES)

            def on_soons_change(payload: Any) -> None:
                logging.getLogger("realtime_watcher.listener").info(
                    "Realtime change observed on %s (event=%s)",
                    TABLE_FINAL_SOONS,
                    payload.get("eventType"),
                )
                event_queue.put(TABLE_FINAL_SOONS)

            channel.on_postgres_changes("*", on_movies_change, table=TABLE_FINAL_MOVIES, schema="public")
            channel.on_postgres_changes("*", on_soons_change, table=TABLE_FINAL_SOONS, schema="public")

            await client.realtime.connect()
            await channel.subscribe()
            logger.info(
                "Subscribed to realtime changes for public.%s and public.%s",
                TABLE_FINAL_MOVIES,
                TABLE_FINAL_SOONS,
            )

            while not stop_event.is_set():
                if not client.realtime.is_connected:
                    raise ConnectionError("Supabase realtime socket disconnected")
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            logger.exception(
                "Realtime subscription loop error (%s). Reconnecting in %.1fs...",
                exc,
                RECONNECT_SECONDS,
            )
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
    _configure_logging()
    artifact_logging.setup_logging()

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
