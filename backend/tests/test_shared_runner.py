from contextlib import redirect_stdout
from io import StringIO
from threading import Event, Lock
from time import sleep
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.config.registry import DATAFLOW_REGISTRY, REGISTRY, registered_post_stage_dataflows
from backend.config.runners import runPlan, _run_shared_update_round, _run_shared_updates
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext


class SharedRunnerTests(TestCase):
    def test_alert_only_plan_runs_unique_dispatcher_without_catalog_stages(self):
        dispatchers = [cls for _key, cls in registered_post_stage_dataflows()]
        calls = []

        def run_group(kind, key, _run_id, **kwargs):
            calls.append((kind, key, kwargs["classes_override"]))
            return True

        with patch("backend.config.runners._run_scheduled_scrapes") as scrape, patch(
            "backend.config.runners._run_shared_updates"
        ) as update, patch("backend.config.runners.runGroup", side_effect=run_group):
            with redirect_stdout(StringIO()):
                self.assertTrue(runPlan(1, [("dataflow", "alerts", dispatchers)]))

        self.assertEqual(calls, [("dataflow", "alerts", dispatchers)])
        scrape.assert_not_called()
        update.assert_not_called()

    def test_empty_plan_is_a_successful_no_op(self):
        with patch("backend.config.runners._run_scheduled_scrapes") as scrape, patch(
            "backend.config.runners._run_shared_updates"
        ) as update, patch("backend.config.runners.runGroup") as run_group:
            output = StringIO()
            with redirect_stdout(output):
                self.assertTrue(runPlan(1, []))

        self.assertIn("Nothing selected.", output.getvalue())
        scrape.assert_not_called()
        update.assert_not_called()
        run_group.assert_not_called()

    def test_cleaning_replacement_scope_requires_selected_mapping_stage(self):
        clean, mapper = DATAFLOW_REGISTRY["nowPlayingData"][:2]
        for classes, expected in (([clean], frozenset()), ([clean, mapper], frozenset({"allShowtimes"}))):
            with self.subTest(classes=[cls.__name__ for cls in classes]):
                contexts = []

                def stage(_kind, _key, _run_id, **kwargs):
                    contexts.append(kwargs["request_context"].selected_mapping_tables)
                    return {cls: True for cls in kwargs["classes_override"]}

                with patch("backend.config.runners.runGroup", side_effect=stage), redirect_stdout(StringIO()):
                    self.assertTrue(runPlan(10, [("dataflow", "nowPlayingData", classes)]))
                self.assertTrue(contexts)
                self.assertTrue(all(selected == expected for selected in contexts))

    def test_everything_compiles_to_one_scrape_phase_and_three_dataflow_stages(self):
        events = []

        def run_group(kind, key, run_id, **kwargs):
            classes = kwargs["classes_override"]
            events.append(("stage", [cls.__name__ for cls in classes]))
            return {cls: True for cls in classes}

        plan = [("cinema", key) for key in REGISTRY]
        plan += [("dataflow", key) for key in DATAFLOW_REGISTRY]
        with patch("backend.config.runners._run_scheduled_scrapes", side_effect=lambda items, *_args, **_kwargs: events.append(("scrape", len(items))) or True), patch("backend.config.runners.runGroup", side_effect=run_group), patch("backend.config.runners._run_shared_updates", side_effect=lambda entries, *_args, **_kwargs: events.append(("update", [cls.__name__ for _key, cls in entries])) or {cls: True for _key, cls in entries}):
            with redirect_stdout(StringIO()):
                self.assertTrue(runPlan(1, plan))

        self.assertEqual(events[0], ("scrape", sum(map(len, REGISTRY.values()))))
        self.assertEqual(
            [event[0] for event in events],
            ["scrape", "stage", "stage", "update", "stage"],
        )
        self.assertEqual(events[-1][1], ["MovieNotificationDispatcher"])

    def test_selected_dispatchers_run_without_selecting_catalog_updates(self):
        date_alert = next(
            cls
            for cls in DATAFLOW_REGISTRY["comingSoonsData"]
            if cls.__name__ == "MovieNotificationDispatcher"
        )
        ticket_alert = next(
            cls
            for cls in DATAFLOW_REGISTRY["nowPlayingData"]
            if cls.__name__ == "MovieNotificationDispatcher"
        )
        letterboxd_alert = next(
            cls
            for cls in DATAFLOW_REGISTRY["nowPlayingData"]
            if cls.__name__ == "MovieNotificationDispatcher"
        )
        calls = []

        def run_group(_kind, _key, _run_id, **kwargs):
            classes = kwargs["classes_override"]
            calls.extend(cls.__name__ for cls in classes)
            return {cls: True for cls in classes}

        output = StringIO()
        plan = [
            ("dataflow", "comingSoonsData", [date_alert]),
            ("dataflow", "nowPlayingData", [ticket_alert, letterboxd_alert]),
        ]
        with patch("backend.config.runners.runGroup", side_effect=run_group), redirect_stdout(output):
            self.assertTrue(runPlan(1, plan))

        self.assertEqual(
            calls,
            [
                "MovieNotificationDispatcher",
            ],
        )
        self.assertNotIn("was not selected", output.getvalue())

    def test_dispatcher_is_skipped_when_its_selected_catalog_update_fails(self):
        date_alert = next(
            cls
            for cls in DATAFLOW_REGISTRY["comingSoonsData"]
            if cls.__name__ == "MovieNotificationDispatcher"
        )
        update = next(
            cls
            for cls in DATAFLOW_REGISTRY["comingSoonsData"]
            if cls.__name__ == "ComingSoonsUpdate"
        )
        calls = []

        def run_updates(entries, *_args, **_kwargs):
            return {cls: False for _key, cls in entries}

        def run_group(_kind, _key, _run_id, **kwargs):
            calls.extend(cls.__name__ for cls in kwargs["classes_override"])
            return {cls: True for cls in kwargs["classes_override"]}

        output = StringIO()
        plan = [("dataflow", "comingSoonsData", [update, date_alert])]
        with patch("backend.config.runners._run_shared_updates", side_effect=run_updates), patch(
            "backend.config.runners.runGroup", side_effect=run_group
        ), redirect_stdout(output):
            self.assertFalse(runPlan(1, plan))

        self.assertEqual(calls, [])
        self.assertIn("Skipped Movie notifications: Coming Soon update failed", output.getvalue())

    def test_coming_soon_date_alerts_run_after_the_coming_soon_publication_commits(self):
        events = []
        publication = type("Publication", (), {"commit": lambda _self: events.append("commit")})()

        def run_group(_kind, _key, _run_id, **kwargs):
            names = [cls.__name__ for cls in kwargs["classes_override"]]
            if "MovieNotificationDispatcher" in names:
                self.assertEqual(events[-1], "commit")
                events.append("date-alert")
            else:
                kwargs.get("request_context")
                if "request_context" in kwargs:
                    kwargs["request_context"].publications["comingsoons"] = publication
                events.append("stage")
            return {cls: True for cls in kwargs["classes_override"]}

        def run_update(entries, *_args, **_kwargs):
            events.append("update")
            return {cls: True for _key, cls in entries}

        with patch("backend.config.runners.runGroup", side_effect=run_group), patch(
            "backend.config.runners._run_shared_updates", side_effect=run_update
        ), redirect_stdout(StringIO()):
            self.assertTrue(
                runPlan(1, [("dataflow", "comingSoonsData")])
            )
        self.assertEqual(events[-3:], ["update", "commit", "date-alert"])

    def test_letterboxd_source_alerts_wait_for_both_catalog_publications(self):
        events = []

        class Publication:
            def __init__(self, label):
                self.label = label

            def commit(self):
                events.append(f"commit:{self.label}")

        def run_group(_kind, _key, _run_id, **kwargs):
            names = [cls.__name__ for cls in kwargs["classes_override"]]
            if "MovieNotificationDispatcher" in names:
                self.assertIn("commit:comingsoons", events)
                self.assertIn("commit:nowplayings", events)
                events.append("letterboxd-alerts")
            return {cls: True for cls in kwargs["classes_override"]}

        def run_update(entries, _run_id, context, **_kwargs):
            for key, cls in entries:
                events.append(f"update:{key}")
                context.publications[
                    {"comingSoonsData": "comingsoons", "nowPlayingData": "nowplayings"}[key]
                ] = Publication(
                    {"comingSoonsData": "comingsoons", "nowPlayingData": "nowplayings"}[key]
                )
            return {cls: True for _key, cls in entries}

        plan = [
            ("dataflow", "comingSoonsData"),
            ("dataflow", "nowPlayingData"),
        ]
        with patch("backend.config.runners.runGroup", side_effect=run_group), patch(
            "backend.config.runners._run_shared_updates", side_effect=run_update
        ), redirect_stdout(StringIO()):
            self.assertTrue(runPlan(1, plan))
        self.assertGreater(events.index("commit:comingsoons"), events.index("update:comingSoonsData"))
        self.assertGreater(events.index("commit:nowplayings"), events.index("update:nowPlayingData"))
        self.assertGreater(events.index("letterboxd-alerts"), events.index("commit:comingsoons"))
        self.assertGreater(events.index("letterboxd-alerts"), events.index("commit:nowplayings"))

    def test_failed_category_skips_its_dependents_but_other_categories_continue(self):
        calls = []

        def run_group(kind, key, run_id, **kwargs):
            classes = kwargs["classes_override"]
            calls.append((kind, key, tuple(cls.__name__ for cls in classes)))
            if any(cls.__name__ == "ComingSoonsClean" for cls in classes):
                return {cls: cls.__name__ != "ComingSoonsClean" for cls in classes}
            return {cls: True for cls in classes}

        plan = [
            ("dataflow", "comingSoonsData", DATAFLOW_REGISTRY["comingSoonsData"]),
            ("dataflow", "nowPlayingData", DATAFLOW_REGISTRY["nowPlayingData"]),
        ]
        with patch("backend.config.runners.runGroup", side_effect=run_group), patch("backend.config.runners._run_shared_updates", side_effect=lambda entries, *_args, **_kwargs: {cls: True for _key, cls in entries}) as shared_updates:
            with redirect_stdout(StringIO()):
                self.assertFalse(runPlan(1, plan))

        tmdb_calls = [call for call in calls if any(name.endswith("Tmdb") for name in call[2])]
        self.assertEqual(len(tmdb_calls), 1)
        self.assertEqual(tmdb_calls[0][1], "Tmdb")
        update_entries = shared_updates.call_args.args[0]
        self.assertEqual([key for key, _cls in update_entries], ["nowPlayingData"])

    def test_update_only_plan_runs_without_implicit_clean_or_tmdb(self):
        update = next(
            cls
            for cls in DATAFLOW_REGISTRY["comingSoonsData"]
            if cls.__name__ == "ComingSoonsUpdate"
        )
        with patch("backend.config.runners.runGroup") as run_group, patch("backend.config.runners._run_shared_updates", return_value={update: True}) as shared_updates:
            with redirect_stdout(StringIO()):
                self.assertTrue(runPlan(1, [("dataflow", "comingSoonsData", [update])]))
        run_group.assert_not_called()
        self.assertEqual(shared_updates.call_args.args[0], [("comingSoonsData", update)])

    def test_shared_update_prefetches_union_and_uses_one_five_worker_pool(self):
        first = next(
            cls
            for cls in DATAFLOW_REGISTRY["nowPlayingData"]
            if cls.__name__ == "NowPlayingsUpdate"
        )
        second = DATAFLOW_REGISTRY["cinemathequeData"][-1]
        entries = [("first", first), ("second", second)]
        targets = {first: [{"id": f"a{i}", "tmdb_id": i} for i in range(4)], second: [{"id": f"b{i}", "tmdb_id": i + 4} for i in range(4)]}
        observations = {"prefetch": [], "ratings": [], "finished": [], "active": 0, "peak": 0}
        lock = Lock()

        class FakeFlow:
            def __init__(self, cls):
                self.cls = cls
                self._update_tmdb = {}

            def beginSharedUpdate(self):
                return targets[self.cls]

            def prepareUpdateTmdb(self, rows):
                observations["prefetch"].append([row["tmdb_id"] for row in rows])
                self._update_tmdb = {row["tmdb_id"]: {} for row in rows}

            def loadImdbRatings(self, rows):
                observations["ratings"].append(len(rows))
                return {"tt1": {"rating": 7.0, "votes": 10}}

            def process_row(self, row):
                with lock:
                    observations["active"] += 1
                    observations["peak"] = max(observations["peak"], observations["active"])
                sleep(0.005)
                with lock:
                    observations["active"] -= 1
                return {"id": row["id"]}

            def finishSharedUpdate(self, _count, rows):
                observations["finished"].append((self.cls, len(rows)))

            def finishSharedDataRun(self, successful):
                self.assert_successful = successful

            def flush_summary(self, _successful):
                pass

            def trace_note(self, _note):
                pass

            def closeDataflowRequests(self):
                pass

        spec = {"make_instance": lambda cls, _key, _run, _context: FakeFlow(cls), "cleanup": lambda _flow: None}
        context = DataflowRequestContext()
        with patch("backend.config.runners.dataflowDictionary", spec):
            results = _run_shared_update_round(entries, 1, 1, context)
        context.close()

        self.assertTrue(all(result.ok for result in results.values()))
        self.assertEqual(observations["prefetch"], [list(range(8))])
        self.assertEqual(observations["ratings"], [8])
        self.assertEqual(sorted(count for _cls, count in observations["finished"]), [4, 4])
        self.assertLessEqual(observations["peak"], 5)

    def test_update_rows_finish_and_stop_timing_before_other_categories(self):
        fast = DATAFLOW_REGISTRY["comingSoonsData"][2]
        slow = DATAFLOW_REGISTRY["nowPlayingData"][2]
        empty = DATAFLOW_REGISTRY["cinemathequeData"][2]
        clock = [0.0]
        fast_displayed = Event()
        slow_returned = Event()
        finished = []
        ui = Mock()
        ui.__enter__ = Mock(return_value=ui)
        ui.__exit__ = Mock(return_value=False)

        def display(cls, result):
            finished.append((cls, result.secs, result.ok))
            if cls is fast:
                self.assertFalse(slow_returned.is_set())
                fast_displayed.set()

        ui.finish_item.side_effect = display

        class Flow:
            def __init__(self, cls):
                self.cls = cls

            def beginSharedUpdate(self):
                return [] if self.cls is empty else [{"tmdb_id": 1}]

            def prepareUpdateTmdb(self, _rows):
                self._update_tmdb = {}

            def loadImdbRatings(self, _rows):
                return {}

            def process_row(self, row):
                if self.cls is slow:
                    if not fast_displayed.wait(timeout=2):
                        raise AssertionError("Fast category was not displayed before slow work finished")
                    slow_returned.set()
                return row

            def finishSharedUpdate(self, count, rows):
                self.count = count
                self.rows = rows
                clock[0] = {empty: 5.0, fast: 10.0, slow: 30.0}[self.cls]

            def finishSharedDataRun(self, successful):
                self.successful = successful

            def trace_note(self, _note):
                pass

            def closeDataflowRequests(self):
                pass

        flows = {cls: Flow(cls) for cls in (fast, slow, empty)}
        spec = {"make_instance": lambda cls, *_args: flows[cls], "cleanup": lambda _flow: None}
        context = DataflowRequestContext()
        try:
            with patch("backend.config.runners.dataflowDictionary", spec), patch(
                "backend.config.runners.RichRunUI", return_value=ui
            ), patch("backend.config.runners._average_times", return_value={}), patch(
                "backend.config.runners.time.monotonic", side_effect=lambda: clock[0]
            ), patch("backend.config.runners.RUNNING_NON_INTERACTIVE", True):
                output = StringIO()
                with redirect_stdout(output):
                    results = _run_shared_updates(
                        [("fast", fast), ("slow", slow), ("empty", empty)],
                        1,
                        context,
                        console=Mock(is_terminal=False),
                    )
            self.assertEqual(results, {fast: True, slow: True, empty: True})
            self.assertEqual(finished, [(empty, 5.0, True), (fast, 10.0, True), (slow, 30.0, True)])
            self.assertTrue(slow_returned.is_set())
            self.assertIn(f"{fast.__name__}: 00m10s", output.getvalue())
            self.assertIn(f"{slow.__name__}: 00m30s", output.getvalue())
            self.assertIn(f"{empty.__name__}: 00m05s", output.getvalue())
            for cls in (fast, slow, empty):
                self.assertTrue(flows[cls].successful)
                self.assertEqual(flows[cls].count, len(flows[cls].rows))
        finally:
            context.close()

    def test_update_retry_times_accumulate_without_restarting_successful_categories(self):
        fast = DATAFLOW_REGISTRY["comingSoonsData"][2]
        retry = DATAFLOW_REGISTRY["nowPlayingData"][2]
        ui = Mock()
        ui.__enter__ = Mock(return_value=ui)
        ui.__exit__ = Mock(return_value=False)
        rounds = []

        def round_results(entries, _run, attempt, _context, *, on_progress, on_result):
            from backend.utils.console.progressBars import RunResult

            rounds.append([cls for _key, cls in entries])
            results = {}
            for _key, cls in entries:
                result = RunResult(cls.__name__, 5.0 if cls is fast else 7.0, cls is fast or attempt == 3, attempt)
                results[cls] = result
                on_result(cls, result)
            return results

        context = DataflowRequestContext()
        try:
            with patch("backend.config.runners.RichRunUI", return_value=ui), patch(
                "backend.config.runners._average_times", return_value={}
            ), patch("backend.config.runners._run_shared_update_round", side_effect=round_results):
                results = _run_shared_updates([("fast", fast), ("retry", retry)], 1, context, console=Mock(is_terminal=False))
            self.assertEqual(results, {fast: True, retry: True})
            self.assertEqual(rounds, [[fast, retry], [retry], [retry]])
            completed = [(call.args[0], call.args[1].secs, call.args[1].attempts) for call in ui.finish_item.call_args_list]
            self.assertEqual(completed, [(fast, 5.0, 1), (retry, 21.0, 3)])
        finally:
            context.close()

    def test_update_initialization_and_finalization_failures_report_failure_once(self):
        cls = DATAFLOW_REGISTRY["comingSoonsData"][2]
        for failed_method in ("beginSharedUpdate", "finishSharedUpdate"):
            with self.subTest(failed_method=failed_method):
                flow = Mock()
                flow._publication = None
                flow.beginSharedUpdate.return_value = []
                getattr(flow, failed_method).side_effect = RuntimeError("controlled failure")
                completed = Mock()
                context = DataflowRequestContext()
                try:
                    with patch.dict("backend.config.runners.dataflowDictionary", {"make_instance": lambda *_args: flow}), patch("backend.config.runners.artifactPrinting"):
                        results = _run_shared_update_round([("category", cls)], 1, 1, context, on_result=completed)
                    self.assertFalse(results[cls].ok)
                    completed.assert_called_once_with(cls, results[cls])
                    flow.discardPublicationStage.assert_called_once()
                    flow.flush_summary.assert_called_once_with(successful=False)
                    flow.finishSharedDataRun.assert_not_called()
                finally:
                    context.close()


if __name__ == "__main__":
    import unittest

    unittest.main()
