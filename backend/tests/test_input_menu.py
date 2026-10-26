from io import StringIO
from unittest import TestCase
from unittest.mock import patch

from rich.console import Console

from backend.config.registry import DATAFLOW_REGISTRY, REGISTRY, registered_post_stage_dataflows
from backend.utils.console import inputMenu
from backend.utils.console.utils.readchar import Keys


class _FakeLive:
    last_renderable = None

    def __init__(self, *_args, **_kwargs):
        type(self).last_renderable = _args[0] if _args else None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def update(self, _renderable):
        type(self).last_renderable = _renderable


class InputMenuTests(TestCase):
    def _select_mode(self, keys):
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu, "read_key", side_effect=keys
        ):
            return inputMenu._select_mode_and_groups(Console(file=StringIO()))

    def _select_items(self, keys, classes):
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu, "read_key", side_effect=keys
        ):
            return inputMenu._select_registry_items(
                Console(file=StringIO()), "Test", classes
            )

    def test_top_level_alerts_mode_is_available_after_existing_modes(self):
        mode, groups = self._select_mode([Keys.RIGHT] * 4 + [Keys.ENTER])

        self.assertEqual(mode, "alerts")
        self.assertEqual(groups, set())
        output = StringIO()
        Console(file=output, width=120).print(_FakeLive.last_renderable)
        self.assertIn("Alerts", output.getvalue())
        self.assertNotIn("ALERTS", output.getvalue())

    def test_none_group_checkbox_clears_when_a_group_is_selected(self):
        mode, groups = self._select_mode(
            [
                Keys.RIGHT,
                Keys.ENTER,  # All mode
                Keys.RIGHT,
                Keys.SPACE,  # None
                Keys.RIGHT,
                Keys.SPACE,  # Soons
                Keys.ENTER,
            ]
        )

        self.assertEqual(mode, "all")
        self.assertEqual(groups, {"Soons"})

    def test_none_group_checkbox_can_finish_with_no_groups(self):
        mode, groups = self._select_mode(
            [Keys.RIGHT, Keys.ENTER, Keys.RIGHT, Keys.SPACE, Keys.ENTER]
        )

        self.assertEqual(mode, "all")
        self.assertEqual(groups, set())

    def test_none_runner_checkbox_can_finish_with_no_runners(self):
        picked, backed = self._select_items(
            [Keys.RIGHT, Keys.SPACE, Keys.ENTER], [REGISTRY["allSoons"][0]]
        )

        self.assertEqual(picked, [])
        self.assertFalse(backed)

    def test_selecting_a_runner_clears_none(self):
        runner = REGISTRY["allSoons"][0]
        picked, backed = self._select_items(
            [Keys.RIGHT, Keys.SPACE, Keys.RIGHT, Keys.SPACE, Keys.ENTER], [runner]
        )

        self.assertEqual(picked, [runner])
        self.assertFalse(backed)

    def test_none_clears_a_previously_selected_runner(self):
        runner = REGISTRY["allSoons"][0]
        picked, backed = self._select_items(
            [Keys.RIGHT, Keys.RIGHT, Keys.SPACE, Keys.LEFT, Keys.SPACE, Keys.ENTER],
            [runner],
        )

        self.assertEqual(picked, [])
        self.assertFalse(backed)

    def test_existing_modes_keep_their_group_and_stage_scope(self):
        expected_titles = {
            "all": ["Scrape → Soons", "Dataflow → Soons"],
            "scrape": ["Scrape → Soons"],
            "dataflow": ["Dataflow → Soons"],
        }

        for mode, titles in expected_titles.items():
            with self.subTest(mode=mode):
                seen_titles = []

                def pick_first(_console, title, classes):
                    seen_titles.append(title)
                    return classes[:1], False

                with patch.object(
                    inputMenu, "_select_mode_and_groups", return_value=(mode, {"Soons"})
                ), patch.object(inputMenu, "_select_registry_items", side_effect=pick_first):
                    plan, _header = inputMenu.choose_run_plan()

                self.assertEqual(seen_titles, titles)
                self.assertEqual(len(plan), len(titles))
                self.assertEqual(
                    [entry[0] for entry in plan],
                    ["dataflow" if title.startswith("Dataflow") else "cinema" for title in titles],
                )

    def test_everything_still_selects_every_registered_group(self):
        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("everything", set())
        ):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(len(plan), len(REGISTRY) + len(DATAFLOW_REGISTRY))
        self.assertEqual(
            sum(len(entry[2]) for entry in plan if entry[0] == "cinema"),
            sum(map(len, REGISTRY.values())),
        )
        self.assertEqual(
            sum(len(entry[2]) for entry in plan if entry[0] == "dataflow"),
            sum(map(len, DATAFLOW_REGISTRY.values())),
        )

    def test_alert_mode_selects_unique_registered_post_stage_dispatchers(self):
        alert_classes = [cls for _key, cls in registered_post_stage_dataflows()]

        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("alerts", set())
        ), patch.object(
            inputMenu,
            "_select_registry_items",
            return_value=(alert_classes, False),
        ) as select_items:
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(select_items.call_args.args[2], alert_classes)
        self.assertEqual(len(alert_classes), len(set(alert_classes)))
        self.assertEqual(plan, [("dataflow", "alerts", alert_classes)])

    def test_empty_runner_selection_completes_without_reopening_menu(self):
        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("scrape", {"Soons"})
        ) as select_mode, patch.object(
            inputMenu, "_select_registry_items", return_value=([], False)
        ) as select_items:
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(plan, [])
        select_mode.assert_called_once()
        select_items.assert_called_once()

    def test_none_skips_only_its_group_and_keeps_other_selected_groups(self):
        coming_soon_clean = DATAFLOW_REGISTRY["comingSoonsData"][0]
        showtime_scraper = REGISTRY["allShowtimes"][0]

        def select_for_title(_console, title, classes):
            if title == "Scrape → Soons":
                return [], False
            if title == "Dataflow → Soons":
                return [coming_soon_clean], False
            if title == "Scrape → Showtimes":
                return [showtime_scraper], False
            return [], False

        with patch.object(
            inputMenu,
            "_select_mode_and_groups",
            return_value=("all", {"Soons", "Showtimes"}),
        ), patch.object(inputMenu, "_select_registry_items", side_effect=select_for_title):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(
            plan,
            [
                ("dataflow", "comingSoonsData", [coming_soon_clean]),
                ("cinema", "allShowtimes", [showtime_scraper]),
            ],
        )

    def test_back_from_runner_selection_restarts_mode_selection(self):
        with patch.object(
            inputMenu,
            "_select_mode_and_groups",
            side_effect=[("scrape", {"Soons"}), ("everything", set())],
        ) as select_mode, patch.object(
            inputMenu, "_select_registry_items", return_value=(None, True)
        ):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(select_mode.call_count, 2)
        self.assertEqual(len(plan), len(REGISTRY) + len(DATAFLOW_REGISTRY))
