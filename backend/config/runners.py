from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED, as_completed
from backend.utils.log.job_lease import create_client
from types import SimpleNamespace
import json, logging, time, os, queue

from rich.console import Console, Group, RenderableType
from rich.panel import Panel
from rich.theme import Theme
from rich.live import Live
from rich.text import Text
from rich.table import Table

from backend.utils.console.progressBars import RunResult, RichRunUI
from backend.config.registry import DATAFLOW_REGISTRY, POST_STAGE_DATAFLOW_CLASS_NAMES, REGISTRY
from backend.scraping.BaseCinema import BaseCinema
from backend.utils.log.artifact_logging import artifactPrinting
from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded
from backend.utils.log.cloudflare_storage import LeaseLostError
from backend.config.scrape_scheduler import optimal_assignment, duration_to_milliseconds, WORKER_COUNT
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext
from backend.dataflow.utils.PublicationWorkspace import CATEGORY_KEYS, publication_scope
from backend.dataflow.utils.InitializeBaseDataflow import logSuccessfulRun
from backend.utils.util_avg_time_history import current_weekday, load_recent_averages
from backend.utils.console.stage_progress import record_stage_duration
from backend.utils.console.stage_progress import render_key_value_table, run_timed_stage, work_progress

DEFAULT_PLAN: list[tuple[str, str]] = [("cinema", "allSoons"), ("cinema", "allShowtimes"), ("cinema", "allTheques"), ("dataflow", "comingSoonsData"), ("dataflow", "nowPlayingData"), ("dataflow", "cinemathequeData")]
RUNNING_NON_INTERACTIVE = os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("JJ_INTEL_MAC_DAILY_RUN") == "true" or os.environ.get("JJ_INTEL_MAC_WEEKLY_RUN") == "true"


def _is_r2_budget_error(error: BaseException) -> bool:
    return isinstance(error, (R2BudgetError, R2BudgetExceeded, LeaseLostError))

cinemaDictionary = {"registry": REGISTRY, "make_instance": lambda cls, key, run_id, _context=None: cls(cinema_type=key, supabase_table_name=key, run_id=run_id), "run_instance": lambda inst: inst.scrape(), "cleanup": lambda instance: (instance.driver.quit() if instance and getattr(instance, "driver", None) else None), "count_label": "Scrapers", "mode": "parallel", "total_strategy": "max", "overall_task_name": "Scrape", "show_transport": True, "get_item_name": lambda cls: getattr(cls, "CINEMA_NAME", cls.__name__)}
dataflowDictionary = {"registry": DATAFLOW_REGISTRY, "make_instance": lambda cls, _key, run_id, context=None: cls(run_id=run_id, **({"request_context": context} if context is not None and cls.__name__ != "TicketAlertDispatcher" else {})), "run_instance": lambda inst: inst.dataRun(), "cleanup": lambda instance: (instance.driver.quit() if instance and getattr(instance, "driver", None) else None), "count_label": "Dataflows", "mode": "sequential", "total_strategy": "sum", "overall_task_name": "Dataflow", "get_item_name": lambda cls: cls.__name__}


def _run_attempt(spec, cls: type, key: str, run_id: int, attempt: int, request_context=None) -> RunResult:
    starting_time, instance, ok, attempt_failed = time.time(), None, False, False
    timing_weekday = current_weekday()
    try:
        instance = spec.make_instance(cls, key, run_id, request_context)
        instance._artifact_item_name = cls.__name__
        instance._artifact_attempt = attempt
        transport_callback = getattr(spec, 'on_transport_change', None)
        if transport_callback:
            start_weekday = getattr(instance, '_timing_weekday', None) or current_weekday()
            instance._timing_transport_callback = lambda transport, elapsed: transport_callback(cls, transport, elapsed, start_weekday)
        callback = getattr(spec, "on_work_progress", None)
        with work_progress((lambda done, total, unit: callback(cls, done, total, unit)) if callback else None):
            spec.run_instance(instance)
        ok = True
    except Exception as error:
        if _is_r2_budget_error(error):
            # Do not make further R2 calls while reporting an exhausted or
            # unavailable budget. Let the job supervisor fail the whole run.
            attempt_failed = True
            raise
        attempt_failed = True
        artifactPrinting(instance, run_id, item_name=cls.__name__, attempt=attempt)
    finally:
        try:
            spec.cleanup(instance)
        except Exception:
            if attempt_failed:
                logging.getLogger(__name__).exception(
                    "Scraper cleanup failed for %s after the attempt had already failed",
                    cls.__name__,
                )
            else:
                artifactPrinting(instance, run_id, item_name=cls.__name__, attempt=attempt)
            ok = False
    elapsed = time.time() - starting_time
    if ok and cls.__name__ in POST_STAGE_DATAFLOW_CLASS_NAMES:
        record_stage_duration(cls.__name__, elapsed, timing_weekday)
    return RunResult(
        name=cls.__name__,
        secs=elapsed,
        ok=ok,
        attempts=attempt,
        detail=getattr(instance, "_notification_summary", None),
    )


def _render_movie_notification_summary(console: Console, result: RunResult) -> None:
    summary = result.detail
    if summary is None:
        return
    table = Table(title="Movie notifications", header_style="bold #66d6f2", expand=False)
    table.add_column("Measure", style="bold")
    table.add_column("Count", justify="right")
    table.add_row("Emails sent", str(summary.emails_sent))
    table.add_row("First-availability updates", str(summary.events_notified))
    table.add_row("Sources synced", str(summary.sources_synced))
    table.add_row("Sources failed", str(summary.sources_failed))
    console.print(Panel.fit(table, border_style="green" if result.ok else "red"))


def _commit_publication_with_progress(publication, key: str, console: Console) -> None:
    """Render publisher metrics as muted tables after the live progress bar."""
    logger = logging.getLogger("backend.dataflow.utils.PostgresPublicationPublisher")
    records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _Capture()
    old_propagate = logger.propagate
    old_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        run_timed_stage(
            f"Publish:{key}",
            f"Publish {key}",
            publication.commit,
            console,
        )
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
        logger.propagate = old_propagate
        for record in records:
            message = record.getMessage()
            if message.startswith("publication_metric="):
                try:
                    metric = json.loads(message.removeprefix("publication_metric="))
                except (ValueError, TypeError):
                    metric = None
                if isinstance(metric, dict):
                    event = str(metric.get("event", "metrics")).removeprefix("publication_").replace("_", " ")
                    table = Table(
                        title=f"Publication · {event}", min_width=min(70, console.width),
                        style="dim", title_style="dim", header_style="dim bold", border_style="grey37",
                    )
                    table.add_column("Measure")
                    table.add_column("Value", overflow="fold")
                    for field, value in metric.items():
                        if field != "event":
                            table.add_row(Text(field.replace("_", " ").capitalize()), Text(str(value)))
                    console.print(table)
                    continue
            style = "yellow" if record.levelno >= logging.WARNING else "dim"
            console.print(Text(message, style=style))


def _preferred_timing_transport(cls: type) -> str:
    if not issubclass(cls, BaseCinema):
        return 'legacy'
    mode = cls.DEFAULT_SCRAPE_MODE or ('selenium' if cls.USES_BROWSER else 'auto')
    return 'requests' if mode in ('auto', 'requests') else 'selenium'


def _average_times(classes: list[type], *, transport: str | None = None, weekday: str | None = None) -> dict[str, float]:
    averages: dict[str, float] = {}
    url, service_key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    machine = os.environ.get("RUNNER_MACHINE")
    if not url or not service_key or not machine or not classes:
        return averages
    try:
        client, weekday = create_client(url, service_key), weekday or current_weekday()
        groups = {}
        for cls in classes:
            groups.setdefault(transport or _preferred_timing_transport(cls), []).append(cls.__name__)
        for selected, names in groups.items():
            averages.update(load_recent_averages(client, names, machine, weekday, transport=selected))
    except Exception:
        # Missing timing history must not prevent a run.
        return {}
    return averages


def _transport_estimate(cls, transport, elapsed, preferred_estimates, cache, *, weekday=None, preferred_weekday=None):
    if transport == _preferred_timing_transport(cls) and (weekday is None or weekday == preferred_weekday):
        return preferred_estimates.get(cls.__name__) or 60.0

    def history(selected):
        key = (cls, selected, weekday)
        if key not in cache:
            options = {'weekday': weekday} if weekday is not None else {}
            cache[key] = _average_times([cls], transport=selected, **options).get(cls.__name__)
        return cache[key]

    estimate = history(transport)
    if estimate is not None:
        return estimate
    if transport == 'requests_selenium_fallback':
        return elapsed + (history('selenium') or 60.0)
    return 60.0


def _run_scheduled_scrapes(items: list[tuple[str, type]], run_id: int, *, console: Console) -> bool:
    """Run selected scrapers in six slots, replanning after each attempt."""
    if not items:
        return True

    classes = [cls for _key, cls in items]
    key_by_class = {cls: key for key, cls in items}
    history_weekday = current_weekday()
    avg_by_name = _average_times(classes, weekday=history_weekday)
    durations = [duration_to_milliseconds(avg_by_name.get(cls.__name__)) for cls in classes]
    pending = list(range(len(items)))
    attempts = [0] * len(items)
    elapsed_seconds = [0.0] * len(items)
    final_results: dict[type, RunResult] = {}
    active: dict = {}
    eta_state = {"remaining": float(sum(durations)), "at": time.monotonic()}
    # _run_attempt uses the attribute-based runner-spec interface used by
    # runGroup. Keep the shared scheduler on that same interface.
    scrape_spec = SimpleNamespace(**cinemaDictionary)
    transport_events = queue.SimpleQueue()
    transport_cache = {}
    scrape_spec.on_transport_change = lambda cls, selected, elapsed, weekday=None: transport_events.put((cls, selected, elapsed, weekday))

    ui_spec = SimpleNamespace(
        count_label="Scrapers",
        mode="parallel",
        total_strategy="max",
        overall_task_name="Scrape",
        show_transport=True,
        get_item_name=lambda cls: getattr(cls, "CINEMA_NAME", cls.__name__),
    )
    ui = RichRunUI(
        ui_spec,
        "Scrape",
        classes,
        lambda cls: durations[classes.index(cls)] / 1000,
        use_live=console.is_terminal and not RUNNING_NON_INTERACTIVE,
        console=console,
        get_eta_secs=lambda: max(0.0, eta_state["remaining"] - (time.monotonic() - eta_state["at"])),
    )

    def recalculate(available_slots: list[int]) -> None:
        now = time.monotonic()
        loads = [0] * WORKER_COUNT
        for _future, (slot, index, started, _attempt) in active.items():
            remaining = durations[index] - int(max(0.0, now - started) * 1000)
            loads[slot] = max(1000, remaining)

        queued = list(pending)
        plan = optimal_assignment([durations[index] for index in queued], loads)
        predicted = max(
            [loads[slot] + sum(durations[queued[j]] for j in plan[slot]) for slot in range(WORKER_COUNT)]
            or [0]
        )
        eta_state.update(remaining=predicted / 1000, at=now)

        # Use the exact assignment first, then fill any equivalent idle slot
        # from the longest remaining job so all available workers stay busy.
        selected: set[int] = set()
        for slot in available_slots:
            assigned = next((queued[position] for position in plan[slot] if queued[position] not in selected), None)
            if assigned is None:
                assigned = next((index for index in sorted(pending, key=lambda i: (-durations[i], i)) if index not in selected), None)
            if assigned is None:
                break
            selected.add(assigned)
            pending.remove(assigned)
            attempts[assigned] += 1
            attempt = attempts[assigned]
            if attempt == 1:
                ui.start_item(classes[assigned], attempt=attempt)
            else:
                ui.retry_item(classes[assigned], attempt=attempt)
            future = executor.submit(
                _run_attempt,
                scrape_spec,
                classes[assigned],
                key_by_class[classes[assigned]],
                run_id,
                attempt,
            )
            active[future] = (slot, assigned, time.monotonic(), attempt)

    ok = True
    with ui:
        with ThreadPoolExecutor(max_workers=WORKER_COUNT) as executor:
            recalculate(list(range(WORKER_COUNT)))
            while active or pending:
                changed = False
                while not transport_events.empty():
                    cls, selected, elapsed, weekday = transport_events.get_nowait()
                    ui.set_item_transport(cls, selected)
                    estimate = _transport_estimate(cls, selected, elapsed, avg_by_name, transport_cache, weekday=weekday, preferred_weekday=history_weekday)
                    index = classes.index(cls)
                    duration = duration_to_milliseconds(estimate)
                    if durations[index] != duration:
                        durations[index] = duration
                        ui.set_item_estimate(cls, estimate)
                        changed = True
                if changed:
                    recalculate([])
                ui.tick()
                done_futures, _ = wait(active, timeout=0.2, return_when=FIRST_COMPLETED)
                if not done_futures:
                    continue
                completed_slots = []
                for future in sorted(done_futures, key=lambda item: active[item][0]):
                    slot, index, _started, attempt = active.pop(future)
                    completed_slots.append(slot)
                    result = future.result()
                    elapsed_seconds[index] += result.secs
                    if result.ok or attempt >= 3:
                        final = RunResult(classes[index].__name__, elapsed_seconds[index], result.ok, attempt)
                        final_results[classes[index]] = final
                        ui.finish_item(classes[index], final)
                        ok = ok and result.ok
                    else:
                        pending.append(index)
                recalculate(completed_slots)

        ui.finalize()

    if RUNNING_NON_INTERACTIVE or not console.is_terminal:
        print("\n--------------------\n", flush=True)
        for result in final_results.values():
            minutes, seconds = divmod(int(result.secs), 60)
            print(f"{result.name}: {minutes:02d}m{seconds:02d}s", flush=True)
        print("\n--------------------\n", flush=True)
    return ok


def _run_shared_update_round(entries, run_id: int, attempt: int, context: DataflowRequestContext, on_progress=None, on_result=None) -> dict[type, RunResult]:
    started_at = {cls: time.monotonic() for _key, cls in entries}
    results = {}

    def record_result(cls, ok):
        result = RunResult(cls.__name__, time.monotonic() - started_at[cls], ok, attempt)
        results[cls] = result
        if on_result:
            on_result(cls, result)

    flows, targets, updated = {}, {}, {}
    failures: dict[type, bool] = {}
    budget_error: Exception | None = None

    for key, cls in entries:
        flow = None
        try:
            flow = dataflowDictionary["make_instance"](cls, key, run_id, context)
            flow._artifact_item_name = cls.__name__
            flow._artifact_attempt = attempt
            flows[cls] = flow
            with publication_scope(getattr(flow, "_publication", None)):
                targets[cls] = flow.beginSharedUpdate()
        except Exception as error:
            if _is_r2_budget_error(error):
                budget_error = error
                failures[cls] = True
                record_result(cls, False)
                continue
            artifactPrinting(flow, run_id, item_name=cls.__name__, attempt=attempt)
            failures[cls] = True
            if flow is not None:
                try:
                    flow.flush_summary(successful=False)
                except Exception:
                    pass
            record_result(cls, False)

    viable = [cls for _key, cls in entries if cls in flows and cls not in failures]
    all_target_rows = [row for cls in viable for row in targets.get(cls, [])]
    shared_tmdb = {}
    imdb_ratings = {}

    if viable and all_target_rows and budget_error is None:
        try:
            flows[viable[0]].prepareUpdateTmdb(all_target_rows)
            shared_tmdb = flows[viable[0]]._update_tmdb
            for cls in viable:
                flows[cls]._update_tmdb = shared_tmdb

            ratings_entries = [cls for cls in viable if cls.__name__ in {"NowPlayingsUpdate", "CinemathequesUpdate"}]
            ratings_rows = [row for cls in ratings_entries for row in targets.get(cls, [])]
            if ratings_entries and ratings_rows:
                imdb_ratings = flows[ratings_entries[0]].loadImdbRatings(ratings_rows)
            for cls in viable:
                flows[cls]._imdb_ratings = imdb_ratings
                if ratings_entries:
                    flows[cls]._imdb_observation = getattr(flows[ratings_entries[0]], "_imdb_observation", None)
        except Exception as error:
            if _is_r2_budget_error(error):
                budget_error = error
                failures.update({cls: True for cls in viable})
                for cls in viable:
                    record_result(cls, False)
            else:
                for cls in viable:
                    artifactPrinting(flows[cls], run_id, item_name=cls.__name__, attempt=attempt)
                    failures[cls] = True
                    try:
                        flows[cls].flush_summary(successful=False)
                    except Exception:
                        pass
                    record_result(cls, False)

    def finish_category(cls):
        nonlocal budget_error
        try:
            with publication_scope(getattr(flows[cls], "_publication", None)):
                flows[cls].finishSharedUpdate(len(targets.get(cls, [])), updated[cls])
                flows[cls].finishSharedDataRun(successful=True)
        except Exception as error:
            failures[cls] = True
            if _is_r2_budget_error(error):
                budget_error = error
            else:
                artifactPrinting(flows[cls], run_id, item_name=cls.__name__, attempt=attempt)
                try:
                    flows[cls].flush_summary(successful=False)
                except Exception:
                    pass
        record_result(cls, cls not in failures)

    if viable and budget_error is None and not any(cls in failures for cls in viable):
        updated = {cls: [] for cls in viable}
        row_jobs = [(cls, row) for cls in viable for row in targets.get(cls, [])]
        remaining = {cls: len(targets.get(cls, [])) for cls in viable}
        for cls in viable:
            if budget_error is not None:
                break
            if remaining[cls] == 0:
                finish_category(cls)
        if row_jobs:
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_item = {executor.submit(flows[cls].process_row, row): (cls, row) for cls, row in row_jobs}
                pending = set(future_to_item)
                while pending and budget_error is None:
                    done_futures, _ = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
                    if on_progress:
                        on_progress()
                    for future in done_futures:
                        pending.discard(future)
                        cls, _row = future_to_item[future]
                        try:
                            result = future.result()
                            if result:
                                updated[cls].append(result)
                        except Exception as error:
                            if _is_r2_budget_error(error):
                                budget_error = error
                                for pending_future in pending:
                                    pending_future.cancel()
                                break
                            flows[cls].trace_note(f"row_update_failed | error={type(error).__name__}")
                        remaining[cls] -= 1
                        if remaining[cls] == 0 and budget_error is None:
                            # Finalize only this category; other categories keep
                            # using the shared provider cache and worker pool.
                            finish_category(cls)
                    if budget_error is not None:
                        break

    if budget_error is not None:
        failures.update({cls: True for cls in viable})

    for _key, cls in entries:
        flow = flows.get(cls)
        if cls in failures and flow is not None and hasattr(flow, "discardPublicationStage"):
            flow.discardPublicationStage()
        if cls not in results:
            record_result(cls, False)

    for flow in flows.values():
        try:
            dataflowDictionary["cleanup"](flow)
            flow.closeDataflowRequests()
        except Exception:
            pass
    if budget_error is not None:
        raise budget_error
    return results


def _run_shared_updates(entries, run_id: int, context: DataflowRequestContext, *, console: Console) -> dict[type, bool]:
    if not entries:
        return {}

    classes = [cls for _key, cls in entries]
    averages = _average_times(classes)
    ui_spec = SimpleNamespace(
        count_label="Update flows",
        mode="parallel",
        total_strategy="max",
        overall_task_name="Update",
        get_item_name=lambda cls: cls.__name__,
    )
    ui = RichRunUI(ui_spec, "Update", classes, lambda cls: averages.get(cls.__name__, 60.0), use_live=console.is_terminal and not RUNNING_NON_INTERACTIVE, console=console)
    attempts = {cls: 0 for cls in classes}
    durations = {cls: 0.0 for cls in classes}
    pending = list(entries)
    final: dict[type, bool] = {}

    with ui:
        while pending:
            for _key, cls in pending:
                attempts[cls] += 1
                if attempts[cls] == 1:
                    ui.start_item(cls, attempt=1)
                else:
                    ui.retry_item(cls, attempt=attempts[cls])

            def report_result(cls, result):
                durations[cls] += result.secs
                if result.ok or attempts[cls] >= 3:
                    final[cls] = result.ok
                    ui.finish_item(cls, RunResult(cls.__name__, durations[cls], result.ok, attempts[cls]))

            results = _run_shared_update_round(
                pending,
                run_id,
                max(attempts[cls] for _key, cls in pending),
                context,
                on_progress=ui.tick,
                on_result=report_result,
            )
            next_pending = []
            for key, cls in pending:
                result = results[cls]
                if not result.ok and attempts[cls] < 3:
                    next_pending.append((key, cls))
            pending = next_pending
            ui.tick()
        ui.finalize()

    if RUNNING_NON_INTERACTIVE or not console.is_terminal:
        print("\n--------------------\n", flush=True)
        for cls in classes:
            minutes, seconds = divmod(int(durations[cls]), 60)
            print(f"{cls.__name__}: {minutes:02d}m{seconds:02d}s", flush=True)
        print("\n--------------------\n", flush=True)
    return final


def _stage_for_dataflow_class(cls: type) -> str | None:
    name = cls.__name__
    if name in POST_STAGE_DATAFLOW_CLASS_NAMES:
        return "post"
    if name.endswith("Clean"):
        return "clean"
    if name.endswith("Tmdb"):
        return "tmdb"
    if name.endswith("Update"):
        return "update"
    return None


def runGroup(kind: str, key: str, run_id: int, *, classes_override: list[type] | None = None, class_keys: dict[type, str] | None = None, ui_parent: Live | None = None, header_renderable: RenderableType | None = None, console: Console | None = None, mode_override: str | None = None, max_workers_override: int | None = None, request_context: DataflowRequestContext | None = None, return_results: bool = False) -> bool | dict[type, bool]:
    spec_dict = {"cinema": cinemaDictionary, "dataflow": dataflowDictionary}.get(kind)
    spec = SimpleNamespace(**spec_dict)
    spec.mode = mode_override or spec.mode
    if spec.mode == "parallel":
        spec.total_strategy = "max"
    classes = list(classes_override) if classes_override is not None else spec.registry.get(key, [])
    if not classes:
        return {} if return_results else True

    attempt_events: "queue.SimpleQueue[tuple]" = queue.SimpleQueue()
    spec.on_work_progress = lambda cls, done, total, unit: attempt_events.put(("work", cls, done, total, unit))
    transport_cache = {}
    if kind == 'cinema':
        spec.on_transport_change = lambda cls, selected, elapsed, weekday=None: attempt_events.put(('transport', cls, selected, elapsed, weekday))

    def run_one(cls: type) -> RunResult:
        total_secs, last_attempt, ok = 0.0, 0, False
        item_key = (class_keys or {}).get(cls, key)
        detail = None

        for attempt in range(1, 4):
            starting_time, last_attempt, instance = time.time(), attempt, None
            attempt_events.put(("attempt_start", cls, attempt, starting_time))
            result = _run_attempt(spec, cls, item_key, run_id, attempt, request_context)
            total_secs += result.secs
            ok = result.ok
            detail = result.detail
            if ok:
                break

        return RunResult(name=cls.__name__, secs=total_secs, ok=ok, attempts=last_attempt, detail=detail)

    def drain_attempt_events(ui: RichRunUI):
        while True:
            try:
                evt = attempt_events.get_nowait()
            except queue.Empty:
                return

            evt_type, item, attempt, started_at = evt[:4]
            if evt_type == "work":
                ui.set_item_work(item, attempt, started_at, evt[4])
                continue
            if evt_type == 'transport':
                ui.set_item_transport(item, attempt)
                estimate = _transport_estimate(item, attempt, started_at, avg_by_name, transport_cache, weekday=evt[4], preferred_weekday=history_weekday)
                ui.set_item_estimate(item, estimate)
                continue
            if evt_type == "attempt_start":
                if attempt == 1:
                    ui.start_item(item, attempt=attempt, started_at=started_at)
                else:
                    ui.retry_item(item, attempt=attempt, started_at=started_at)

    # GITHUB ACTIONS LOGIC
    if RUNNING_NON_INTERACTIVE:
        results: list[RunResult] = []
        if spec.mode == "parallel":
            with ThreadPoolExecutor(max_workers=max_workers_override or max(1, len(classes))) as ex:
                futures = [ex.submit(run_one, cls) for cls in classes]
                for future in as_completed(futures):
                    results.append(future.result())
        else:
            for cls in classes:
                results.append(run_one(cls))

        print("\n--------------------\n", flush=True)
        for result in results:
            minutes, seconds = divmod(int(result.secs), 60)
            print(f"{result.name}: {minutes:02d}m{seconds:02d}s", flush=True)
        print("\n--------------------\n", flush=True)

        for result in results:
            if result.name == "MovieNotificationDispatcher":
                _render_movie_notification_summary(console or Console(), result)

        return ({cls: next(result.ok for result in results if result.name == cls.__name__) for cls in classes} if return_results else all(result.ok for result in results))

    # LOCAL MACHINE LOGIC
    if not RUNNING_NON_INTERACTIVE:
        FALLBACK = 60.0
        history_weekday = current_weekday()
        avg_by_name = _average_times(classes, weekday=history_weekday)

        results: list[RunResult] = []

        use_embedded = ui_parent is not None
        get_item_est = lambda item: float(avg_by_name.get(item.__name__) or FALLBACK)
        ui = RichRunUI(
            spec,
            key,
            classes,
            get_item_est,
            use_live=not use_embedded and (console or Console()).is_terminal,
            console=console,
        )

        with ui:
            if not classes:
                ui.finalize()
                return

            if use_embedded:
                hdr = header_renderable or Panel.fit(Text("Running...", style="bold"), border_style="grey37")
                ui_parent.update(Group(hdr, ui.renderable))

            if spec.mode == "parallel":
                with ThreadPoolExecutor(max_workers=max_workers_override or max(1, len(classes))) as ex:
                    future_to_item = {ex.submit(run_one, item): item for item in classes}
                    pending = set(future_to_item.keys())
                    while pending:
                        drain_attempt_events(ui)
                        ui.tick()

                        done_futures, _ = wait(pending, timeout=0, return_when=FIRST_COMPLETED)
                        for future in done_futures:
                            pending.discard(future)
                            item = future_to_item[future]
                            result = future.result()
                            results.append(result)
                            ui.finish_item(item, result)
                        time.sleep(0.2)

                drain_attempt_events(ui)
                ui.finalize()

            else:  # sequential
                with ThreadPoolExecutor(max_workers=1) as ex:
                    for item in classes:
                        future = ex.submit(run_one, item)

                        while not future.done():
                            drain_attempt_events(ui)
                            ui.tick()
                            time.sleep(0.2)

                        drain_attempt_events(ui)
                        result = future.result()
                        results.append(result)
                        ui.finish_item(item, result)

                ui.finalize()

            if use_embedded:
                hdr = header_renderable or Panel.fit(Text("Running...", style="bold"), border_style="grey37")
                ui_parent.update(Group(hdr, ui.renderable))

        if not (console or Console()).is_terminal:
            print("\n--------------------\n", flush=True)
            for result in results:
                minutes, seconds = divmod(int(result.secs), 60)
                print(f"{result.name}: {minutes:02d}m{seconds:02d}s", flush=True)
            print("\n--------------------\n", flush=True)

        for result in results:
            if result.name == "MovieNotificationDispatcher":
                _render_movie_notification_summary(console or Console(), result)

        return ({cls: next((r.ok for r in results if r.name == cls.__name__), False) for cls in classes} if return_results else (all(r.ok for r in results) if results else True))


def runPlan(run_id: int, plan: list[tuple[str, str]], header_renderable: RenderableType | None = None) -> bool:
    console = Console(theme=Theme({"progress.elapsed": "bold #9c27f5"}))
    header_renderable = header_renderable or Panel(Text("Running…", style="bold"), title="Run Plan", border_style="grey37")
    console.print(header_renderable)

    if not plan:
        console.print(Panel.fit(Text("Nothing selected.", style="red"), border_style="grey37"))
        return True

    scrape_items: list[tuple[str, type]] = []
    seen_scrapers: set[type] = set()
    flow_selections: dict[str, dict[str, list[type]]] = {}

    for entry in plan:
        if len(entry) == 2:
            kind, key = entry
            classes_override = None
        else:
            kind, key, classes_override = entry

        if kind == "cinema":
            candidates = list(classes_override) if classes_override is not None else list(REGISTRY.get(key, []))
            for cls in candidates:
                if cls in seen_scrapers:
                    continue
                seen_scrapers.add(cls)
                scrape_items.append((key, cls))
        elif kind == "dataflow":
            candidates = list(classes_override) if classes_override is not None else list(DATAFLOW_REGISTRY.get(key, []))
            selected = flow_selections.setdefault(key, {"clean": [], "tmdb": [], "update": [], "post": []})
            for cls in candidates:
                stage = _stage_for_dataflow_class(cls)
                if stage is None or cls in selected[stage]:
                    continue
                selected[stage].append(cls)

    has_flow_work = any(any(classes for classes in stages.values()) for stages in flow_selections.values())
    if not scrape_items and not has_flow_work:
        console.print(Panel.fit(Text("Nothing selected.", style="red"), border_style="grey37"))
        return True

    overall_ok = True
    request_context = DataflowRequestContext()
    request_context.publications = {}
    request_context.selected_mapping_tables = frozenset(
        cls.MAIN_TABLE_NAME
        for stages in flow_selections.values()
        for cls in stages["tmdb"]
        if getattr(cls, "MAIN_TABLE_NAME", None)
    )
    failed_categories: set[str] = set()
    catalog_publication_committed = False
    try:
        if scrape_items:
            console.print(Panel.fit(Text("Scrape", style="bold"), border_style="grey37"))
            overall_ok = _run_scheduled_scrapes(scrape_items, run_id, console=console) and overall_ok
            console.print()

        if has_flow_work:
            console.print(Panel.fit(Text("Dataflow", style="bold"), border_style="grey37"))

        for stage in ("clean", "tmdb", "update"):
            blocked = [
                f"{key}: {cls.__name__}"
                for key, stages in flow_selections.items()
                if key in failed_categories
                for cls in stages[stage]
            ]
            if blocked:
                console.print(Panel.fit(Text(f"Skipped {stage.capitalize()}: " + ", ".join(blocked), style="yellow"), border_style="grey37"))

            entries = [
                (key, cls)
                for key, stages in flow_selections.items()
                if key not in failed_categories
                for cls in stages[stage]
            ]
            if not entries:
                continue

            console.print(Panel.fit(Text(stage.capitalize(), style="grey70"), border_style="grey37"))
            if stage == "update":
                results = _run_shared_updates(entries, run_id, request_context, console=console)
            else:
                items = [cls for _key, cls in entries]
                keys = {cls: key for key, cls in entries}
                results = runGroup(
                    "dataflow",
                    stage.capitalize(),
                    run_id,
                    classes_override=items,
                    class_keys=keys,
                    console=console,
                    mode_override="parallel",
                    max_workers_override=min(3, len(entries)),
                    request_context=request_context,
                    return_results=True,
                )

            for key, cls in entries:
                if not results.get(cls, False):
                    failed_categories.add(key)
                    overall_ok = False
            stage_order = ("clean", "tmdb", "update")
            later_stages = stage_order[stage_order.index(stage) + 1:]
            for key, selected in flow_selections.items():
                if key in failed_categories or any(selected[later] for later in later_stages):
                    continue
                publication = request_context.publications.get(CATEGORY_KEYS.get(key))
                if publication is not None:
                    try:
                        _commit_publication_with_progress(publication, key, console)
                        if key in {
                            "nowPlayingData",
                            "comingSoonsData",
                            "cinemathequeData",
                        }:
                            catalog_publication_committed = True
                        console.print(
                            Panel.fit(
                                Text(f"{key} publication committed", style="green"),
                                border_style="green",
                            )
                        )
                    except Exception:
                        artifactPrinting(None, run_id, item_name=f"{key}Publication", attempt=1)
                        console.print(
                            Panel.fit(
                                Text(
                                    f"{key} publication failed or was unconfirmed; staged records are not reported as live",
                                    style="red",
                                ),
                                border_style="red",
                            )
                        )
                        failed_categories.add(key)
                        overall_ok = False
            console.print()

        if catalog_publication_committed:
            from backend.dataflow.social_previews import refresh_configured_social_previews

            preview_stats = run_timed_stage(
                "SocialPreviewRefresh",
                "Refresh social preview images",
                refresh_configured_social_previews,
                console,
                record_when=lambda value: isinstance(value, dict) and not value.get("failed"),
                outcome_for=lambda value: (
                    "Skipped" if value is None else
                    "Completed with failures" if value.get("failed") else "Complete"
                ),
            )
            if preview_stats is None:
                render_key_value_table(
                    "Social preview images",
                    [("Status", "Skipped or unavailable")],
                    console,
                )
            else:
                render_key_value_table(
                    "Social preview images",
                    [
                        ("Scanned", preview_stats.get("scanned", 0)),
                        ("Updated", preview_stats.get("updated", 0)),
                        ("Unchanged", preview_stats.get("unchanged", 0)),
                        ("Failed", preview_stats.get("failed", 0)),
                        ("Stale", preview_stats.get("stale", 0)),
                        ("Pending", preview_stats.get("pending", 0)),
                        ("Status", "Completed with failures" if preview_stats.get("failed") else "Complete"),
                    ],
                    console,
                    status="failed" if preview_stats.get("failed") else None,
                )

        # Notification dispatchers run after selected updates commit, but can
        # also run alone against the already-published catalog.
        dispatcher_labels = {
            "TicketAlertDispatcher": (
                "Ticket alerts",
                {"nowPlayingData": "Showtimes Update"},
            ),
            "ComingSoonDateAlertDispatcher": (
                "Coming Soon date alerts",
                {"comingSoonsData": "Coming Soon update"},
            ),
            "LetterboxdSourceDispatcher": (
                "Letterboxd source alerts",
                {
                    "comingSoonsData": "Coming Soon update",
                    "nowPlayingData": "Showtimes Update",
                },
            ),
        }
        dispatcher_labels["MovieNotificationDispatcher"] = (
            "Movie notifications", {"comingSoonsData": "Coming Soon update", "nowPlayingData": "Showtimes Update"}
        )
        selected_updates = {
            key for key, stages in flow_selections.items() if stages["update"]
        }
        dispatched = set()
        for category, stages in flow_selections.items():
            for dispatcher in stages["post"]:
                if dispatcher in dispatched:
                    continue
                dispatched.add(dispatcher)
                label, required_updates = dispatcher_labels.get(
                    dispatcher.__name__, ("Notifications", {})
                )
                failed_updates = [
                    update_label
                    for update_category, update_label in required_updates.items()
                    if update_category in selected_updates
                    and update_category in failed_categories
                ]
                if failed_updates:
                    console.print(
                        Panel.fit(
                            Text(
                                f"Skipped {label}: "
                                + ", ".join(failed_updates)
                                + " failed",
                                style="yellow",
                            ),
                            border_style="grey37",
                        )
                    )
                    continue
                console.print(
                    Panel.fit(Text(label, style="grey70"), border_style="grey37")
                )
                dispatch_ok = runGroup(
                    "dataflow",
                    category,
                    run_id,
                    classes_override=[dispatcher],
                    console=console,
                )
                overall_ok = overall_ok and bool(dispatch_ok)
        return overall_ok
    finally:
        request_context.close()
