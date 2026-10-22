from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED, as_completed
from supabase import create_client
from types import SimpleNamespace
import logging, time, os, queue

from rich.console import Console, Group, RenderableType
from rich.panel import Panel
from rich.theme import Theme
from rich.live import Live
from rich.text import Text

from backend.utils.console.progressBars import RunResult, RichRunUI
from backend.config.registry import REGISTRY, DATAFLOW_REGISTRY
from backend.utils.log.artifact_logging import artifactPrinting
from backend.config.scrape_scheduler import optimal_assignment, duration_to_milliseconds, WORKER_COUNT
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext
from backend.dataflow.utils.PublicationWorkspace import CATEGORY_KEYS, publication_scope
from backend.dataflow.utils.InitializeBaseDataflow import logSuccessfulRun

DEFAULT_PLAN: list[tuple[str, str]] = [("cinema", "allSoons"), ("cinema", "allShowtimes"), ("cinema", "allTheques"), ("dataflow", "comingSoonsData"), ("dataflow", "nowPlayingData"), ("dataflow", "cinemathequeData")]
RUNNING_NON_INTERACTIVE = os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("JJ_INTEL_MAC_DAILY_RUN") == "true" or os.environ.get("JJ_INTEL_MAC_WEEKLY_RUN") == "true"

cinemaDictionary = {"registry": REGISTRY, "make_instance": lambda cls, key, run_id, _context=None: cls(cinema_type=key, supabase_table_name=key, run_id=run_id), "run_instance": lambda inst: inst.scrape(), "cleanup": lambda instance: (instance.driver.quit() if instance and getattr(instance, "driver", None) else None), "count_label": "Scrapers", "mode": "parallel", "total_strategy": "max", "overall_task_name": "Scrape", "get_item_name": lambda cls: getattr(cls, "CINEMA_NAME", cls.__name__)}
dataflowDictionary = {"registry": DATAFLOW_REGISTRY, "make_instance": lambda cls, _key, run_id, context=None: cls(run_id=run_id, **({"request_context": context} if context is not None and cls.__name__ != "TicketAlertDispatcher" else {})), "run_instance": lambda inst: inst.dataRun(), "cleanup": lambda instance: (instance.driver.quit() if instance and getattr(instance, "driver", None) else None), "count_label": "Dataflows", "mode": "sequential", "total_strategy": "sum", "overall_task_name": "Dataflow", "get_item_name": lambda cls: cls.__name__}


def _run_attempt(spec, cls: type, key: str, run_id: int, attempt: int, request_context=None) -> RunResult:
    starting_time, instance, ok, attempt_failed = time.time(), None, False, False
    try:
        instance = spec.make_instance(cls, key, run_id, request_context)
        instance._artifact_item_name = cls.__name__
        instance._artifact_attempt = attempt
        spec.run_instance(instance)
        ok = True
    except Exception:
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
    return RunResult(name=cls.__name__, secs=time.time() - starting_time, ok=ok, attempts=attempt)


def _average_times(classes: list[type]) -> dict[str, float]:
    averages: dict[str, float] = {}
    url, service_key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    machine = os.environ.get("RUNNER_MACHINE")
    if not url or not service_key or not machine or not classes:
        return averages
    try:
        response = create_client(url, service_key).table("utilAvgTime").select(
            f"name,avg_time_{machine}"
        ).in_("name", [cls.__name__ for cls in classes]).execute()
        for row in response.data or []:
            name, value = row.get("name"), row.get(f"avg_time_{machine}")
            if name:
                try:
                    parsed = float(value)
                    if parsed > 0 and parsed < float("inf"):
                        averages[name] = parsed
                except (TypeError, ValueError, OverflowError):
                    pass
    except Exception:
        # Missing timing history must not prevent a run.
        return {}
    return averages


def _run_scheduled_scrapes(items: list[tuple[str, type]], run_id: int, *, console: Console) -> bool:
    """Run selected scrapers in six slots, replanning after each attempt."""
    if not items:
        return True

    classes = [cls for _key, cls in items]
    key_by_class = {cls: key for key, cls in items}
    avg_by_name = _average_times(classes)
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

    ui_spec = SimpleNamespace(
        count_label="Scrapers",
        mode="parallel",
        total_strategy="max",
        overall_task_name="Scrape",
        get_item_name=lambda cls: getattr(cls, "CINEMA_NAME", cls.__name__),
    )
    ui = RichRunUI(
        ui_spec,
        "Scrape",
        classes,
        lambda cls: durations[classes.index(cls)] / 1000,
        use_live=console.is_terminal,
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

    if RUNNING_NON_INTERACTIVE:
        print("\n--------------------\n", flush=True)
        for result in final_results.values():
            minutes, seconds = divmod(int(result.secs), 60)
            print(f"{result.name}: {minutes:02d}m{seconds:02d}s", flush=True)
        print("\n--------------------\n", flush=True)
    return ok


def _run_shared_update_round(entries, run_id: int, attempt: int, context: DataflowRequestContext, on_progress=None) -> dict[type, RunResult]:
    started_at = {cls: time.time() for _key, cls in entries}
    flows, targets, updated = {}, {}, {}
    failures: dict[type, bool] = {}

    for key, cls in entries:
        flow = None
        try:
            flow = dataflowDictionary["make_instance"](cls, key, run_id, context)
            flow._artifact_item_name = cls.__name__
            flow._artifact_attempt = attempt
            flows[cls] = flow
            with publication_scope(getattr(flow, "_publication", None)):
                targets[cls] = flow.beginSharedUpdate()
        except Exception:
            artifactPrinting(flow, run_id, item_name=cls.__name__, attempt=attempt)
            failures[cls] = True
            if flow is not None:
                try:
                    flow.flush_summary(successful=False)
                except Exception:
                    pass

    viable = [cls for _key, cls in entries if cls in flows and cls not in failures]
    all_target_rows = [row for cls in viable for row in targets.get(cls, [])]
    shared_tmdb = {}
    imdb_ratings = {}

    if viable and all_target_rows:
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
        except Exception:
            for cls in viable:
                artifactPrinting(flows[cls], run_id, item_name=cls.__name__, attempt=attempt)
                failures[cls] = True
                try:
                    flows[cls].flush_summary(successful=False)
                except Exception:
                    pass

    if viable and not any(cls in failures for cls in viable):
        updated = {cls: [] for cls in viable}
        row_jobs = [(cls, row) for cls in viable for row in targets.get(cls, [])]
        if row_jobs:
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_item = {executor.submit(flows[cls].process_row, row): (cls, row) for cls, row in row_jobs}
                pending = set(future_to_item)
                while pending:
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
                            flows[cls].trace_note(f"row_update_failed | error={type(error).__name__}")

        for cls in viable:
            try:
                with publication_scope(getattr(flows[cls], "_publication", None)):
                    flows[cls].finishSharedUpdate(len(targets.get(cls, [])), updated[cls])
                    flows[cls].finishSharedDataRun(successful=True)
            except Exception:
                artifactPrinting(flows[cls], run_id, item_name=cls.__name__, attempt=attempt)
                failures[cls] = True
                try:
                    flows[cls].flush_summary(successful=False)
                except Exception:
                    pass

    results = {}
    for _key, cls in entries:
        flow = flows.get(cls)
        if cls in failures:
            if flow is not None and hasattr(flow, "discardPublicationStage"):
                flow.discardPublicationStage()
            results[cls] = RunResult(cls.__name__, time.time() - started_at[cls], False, attempt)
        elif flow is not None:
            results[cls] = RunResult(cls.__name__, time.time() - started_at[cls], True, attempt)
        else:
            results[cls] = RunResult(cls.__name__, time.time() - started_at[cls], False, attempt)

    for flow in flows.values():
        try:
            dataflowDictionary["cleanup"](flow)
            flow.closeDataflowRequests()
        except Exception:
            pass
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
    ui = RichRunUI(ui_spec, "Update", classes, lambda cls: averages.get(cls.__name__, 60.0), use_live=console.is_terminal, console=console)
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
            results = _run_shared_update_round(
                pending,
                run_id,
                max(attempts[cls] for _key, cls in pending),
                context,
                on_progress=ui.tick,
            )
            next_pending = []
            for key, cls in pending:
                result = results[cls]
                durations[cls] += result.secs
                if result.ok:
                    final[cls] = True
                    ui.finish_item(cls, RunResult(cls.__name__, durations[cls], True, attempts[cls]))
                elif attempts[cls] >= 3:
                    final[cls] = False
                    ui.finish_item(cls, RunResult(cls.__name__, durations[cls], False, attempts[cls]))
                else:
                    next_pending.append((key, cls))
            pending = next_pending
            ui.tick()
        ui.finalize()

    if RUNNING_NON_INTERACTIVE:
        print("\n--------------------\n", flush=True)
        for cls in classes:
            minutes, seconds = divmod(int(durations[cls]), 60)
            print(f"{cls.__name__}: {minutes:02d}m{seconds:02d}s", flush=True)
        print("\n--------------------\n", flush=True)
    return final


def _stage_for_dataflow_class(cls: type) -> str | None:
    name = cls.__name__
    if name in {
        "TicketAlertDispatcher",
        "ComingSoonDateAlertDispatcher",
        "LetterboxdSourceDispatcher",
    }:
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

    def run_one(cls: type) -> RunResult:
        total_secs, last_attempt, ok = 0.0, 0, False
        item_key = (class_keys or {}).get(cls, key)

        for attempt in range(1, 4):
            starting_time, last_attempt, instance = time.time(), attempt, None
            attempt_events.put(("attempt_start", cls, attempt, starting_time))
            result = _run_attempt(spec, cls, item_key, run_id, attempt, request_context)
            total_secs += result.secs
            ok = result.ok
            if ok:
                break

        return RunResult(name=cls.__name__, secs=total_secs, ok=ok, attempts=last_attempt)

    def drain_attempt_events(ui: RichRunUI):
        while True:
            try:
                evt = attempt_events.get_nowait()
            except queue.Empty:
                return

            evt_type, item, attempt, started_at = evt
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

        return ({cls: next(result.ok for result in results if result.name == cls.__name__) for cls in classes} if return_results else all(result.ok for result in results))

    # LOCAL MACHINE LOGIC
    if not RUNNING_NON_INTERACTIVE:
        FALLBACK = 60.0
        avg_by_name: dict[str, float] = {}

        url, svc_key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        avg_time_col = "avg_time_" + str(os.environ.get("RUNNER_MACHINE"))
        if url and svc_key:
            table, name_col, time_col = "utilAvgTime", "name", f"{avg_time_col}"
            class_names = [cls.__name__ for cls in classes]
            sb = create_client(url, svc_key)
            resp = sb.table(table).select(f"{name_col},{time_col}").in_(name_col, class_names).execute()

            rows = resp.data or []
            for row in rows:
                k = row.get(name_col)
                value = float(row.get(time_col) or 0.0)
                if value > 0:
                    avg_by_name[k] = value

        results: list[RunResult] = []

        use_embedded = ui_parent is not None
        get_item_est = lambda item: float(avg_by_name.get(item.__name__) or FALLBACK)
        ui = RichRunUI(spec, key, classes, get_item_est, use_live=not use_embedded, console=console)

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
    failed_categories: set[str] = set()
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
                        publication.commit()
                    except Exception:
                        artifactPrinting(None, run_id, item_name=f"{key}Publication", attempt=1)
                        failed_categories.add(key)
                        overall_ok = False
            console.print()

        # Notification dispatchers run only after their category update commits.
        dispatcher_labels = {
            "TicketAlertDispatcher": ("Ticket alerts", "Showtimes Update"),
            "ComingSoonDateAlertDispatcher": (
                "Coming Soon date alerts",
                "Coming Soon update",
            ),
            "LetterboxdSourceDispatcher": (
                "Letterboxd source alerts",
                "Showtimes and Coming Soon updates",
            ),
        }
        for category, stages in flow_selections.items():
            for dispatcher in stages["post"]:
                label, required_update = dispatcher_labels.get(
                    dispatcher.__name__, ("Notifications", "catalog update")
                )
                if not stages["update"]:
                    console.print(
                        Panel.fit(
                            Text(
                                f"Skipped {label}: {required_update} was not selected",
                                style="yellow",
                            ),
                            border_style="grey37",
                        )
                    )
                    continue
                if dispatcher.__name__ == "LetterboxdSourceDispatcher":
                    required_categories = ("comingSoonsData", "nowPlayingData")
                    missing_updates = [
                        required
                        for required in required_categories
                        if not flow_selections.get(required, {}).get("update")
                    ]
                    failed_updates = [
                        required
                        for required in required_categories
                        if required in failed_categories
                    ]
                    if missing_updates:
                        console.print(
                            Panel.fit(
                                Text(
                                    "Skipped Letterboxd source alerts: both catalog updates must be selected",
                                    style="yellow",
                                ),
                                border_style="grey37",
                            )
                        )
                        continue
                    if failed_updates:
                        console.print(
                            Panel.fit(
                                Text(
                                    "Skipped Letterboxd source alerts: "
                                    + ", ".join(failed_updates)
                                    + " failed",
                                    style="yellow",
                                ),
                                border_style="grey37",
                            )
                        )
                        continue
                if category in failed_categories:
                    console.print(
                        Panel.fit(
                            Text(
                                f"Skipped {label}: {required_update} failed",
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
