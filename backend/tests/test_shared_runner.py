from contextlib import redirect_stdout
from io import StringIO
from threading import Lock
from time import sleep
from unittest import TestCase
from unittest.mock import patch

from backend.config.registry import DATAFLOW_REGISTRY, REGISTRY
from backend.config.runners import runPlan, _run_shared_update_round
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext


class SharedRunnerTests(TestCase):
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
            ["scrape", "stage", "stage", "update", "stage", "stage", "stage"],
        )
        self.assertEqual(events[-3][1], ["ComingSoonDateAlertDispatcher"])
        self.assertEqual(events[-2][1], ["TicketAlertDispatcher"])
        self.assertEqual(events[-1][1], ["LetterboxdSourceDispatcher"])

    def test_coming_soon_date_alerts_run_after_the_coming_soon_publication_commits(self):
        events = []
        publication = type("Publication", (), {"commit": lambda _self: events.append("commit")})()

        def run_group(_kind, _key, _run_id, **kwargs):
            names = [cls.__name__ for cls in kwargs["classes_override"]]
            if "ComingSoonDateAlertDispatcher" in names:
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
            if "LetterboxdSourceDispatcher" in names:
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


if __name__ == "__main__":
    import unittest

    unittest.main()
