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

    def update(self, renderable):
        type(self).last_renderable = renderable


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
            return inputMenu._select_registry_items(Console(file=StringIO()), "Test", classes)

    def test_top_level_modes_can_be_combined_with_space(self):
        mode, selected = self._select_mode(
            [Keys.RIGHT] * 2 + [Keys.SPACE, Keys.RIGHT, Keys.SPACE, Keys.ENTER]
        )

        self.assertEqual(mode, "combined")
        self.assertEqual(selected, {"scrape", "dataflow"})

    def test_alerts_is_space_selectable_and_all_is_removed_from_top_level(self):
        mode, selected = self._select_mode(
            [Keys.RIGHT] * 4 + [Keys.SPACE, Keys.ENTER]
        )

        self.assertEqual((mode, selected), ("combined", {"alerts"}))
        output = StringIO()
        Console(file=output, width=120).print(_FakeLive.last_renderable)
        self.assertIn("Alerts", output.getvalue())
        self.assertNotIn("All", output.getvalue())

    def test_everything_toggles_all_modes_and_none_clears_them(self):
        mode, selected = self._select_mode(
            [Keys.SPACE, Keys.RIGHT, Keys.RIGHT, Keys.SPACE, Keys.ENTER]
        )
        self.assertEqual((mode, selected), ("combined", {"dataflow", "alerts"}))

        mode, selected = self._select_mode(
            [Keys.RIGHT, Keys.SPACE, Keys.ENTER]
        )
        self.assertEqual((mode, selected), ("none", set()))

    def test_empty_top_level_selection_is_none(self):
        self.assertEqual(self._select_mode([Keys.ENTER]), ("none", set()))

    def test_environment_selector_uses_keyboard_selection(self):
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu, "read_key", side_effect=[Keys.SPACE, Keys.ENTER]
        ):
            self.assertEqual(inputMenu.choose_environment_target(Console(file=StringIO())), "development")
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu, "read_key", side_effect=[Keys.RIGHT, Keys.SPACE, Keys.ENTER]
        ):
            self.assertEqual(inputMenu.choose_environment_target(Console(file=StringIO())), "production")

    def test_quit_key_interrupts_the_mode_selector(self):
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu, "read_key", return_value="q"
        ), self.assertRaises(KeyboardInterrupt):
            inputMenu._select_mode_and_groups(Console(file=StringIO()))

    def test_group_none_checkbox_clears_when_a_group_is_selected(self):
        with patch.object(inputMenu, "Live", _FakeLive), patch.object(
            inputMenu,
            "read_key",
            side_effect=[Keys.RIGHT, Keys.SPACE, Keys.RIGHT, Keys.SPACE, Keys.ENTER],
        ):
            groups, backed = inputMenu._select_group_items(Console(file=StringIO()), "Groups", ["Soons"])
        self.assertEqual(groups, {"Soons"})
        self.assertFalse(backed)

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

    def test_combined_modes_keep_scrape_and_dataflow_scope(self):
        expected_titles = ["Scrape → Soons", "Dataflow → Soons"]
        seen_titles = []

        def pick_first(_console, title, classes):
            seen_titles.append(title)
            return classes[:1], False

        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("combined", {"scrape", "dataflow"})
        ), patch.object(
            inputMenu, "_select_group_items", side_effect=[({"Soons"}, False), ({"Soons"}, False)]
        ), patch.object(inputMenu, "_select_registry_items", side_effect=pick_first):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(seen_titles, expected_titles)
        self.assertEqual(len(plan), 2)
        self.assertEqual([entry[0] for entry in plan], ["cinema", "dataflow"])

    def test_everything_includes_all_registered_work_and_alert_dispatchers(self):
        with patch.object(inputMenu, "_select_mode_and_groups", return_value=("everything", set())):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(len(plan), len(REGISTRY) + len(DATAFLOW_REGISTRY) + 1)
        self.assertEqual(
            sum(len(entry[2]) for entry in plan if entry[0] == "cinema"),
            sum(map(len, REGISTRY.values())),
        )
        alerts = [entry for entry in plan if len(entry) == 3 and entry[1] == "alerts"]
        self.assertEqual(alerts, [("dataflow", "alerts", [cls for _key, cls in registered_post_stage_dataflows()])])

    def test_alert_mode_selects_unique_registered_post_stage_dispatchers(self):
        alert_classes = [cls for _key, cls in registered_post_stage_dataflows()]
        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("combined", {"alerts"})
        ), patch.object(
            inputMenu, "_select_registry_items", return_value=(alert_classes, False)
        ) as select_items:
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(select_items.call_args.args[2], alert_classes)
        self.assertEqual(len(alert_classes), len(set(alert_classes)))
        self.assertEqual(plan, [("dataflow", "alerts", alert_classes)])

    def test_empty_runner_selection_completes_without_reopening_menu(self):
        with patch.object(
            inputMenu, "_select_mode_and_groups", return_value=("combined", {"scrape"})
        ) as select_mode, patch.object(
            inputMenu, "_select_group_items", return_value=({"Soons"}, False)
        ), patch.object(inputMenu, "_select_registry_items", return_value=([], False)) as select_items:
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(plan, [])
        select_mode.assert_called_once()
        select_items.assert_called_once()

    def test_back_from_runner_selection_restarts_mode_selection(self):
        with patch.object(
            inputMenu,
            "_select_mode_and_groups",
            side_effect=[("combined", {"scrape"}), ("everything", set())],
        ), patch.object(
            inputMenu,
            "_select_group_items",
            return_value=({"Soons"}, False),
        ), patch.object(inputMenu, "_select_registry_items", return_value=(None, True)):
            plan, _header = inputMenu.choose_run_plan()

        self.assertEqual(len(plan), len(REGISTRY) + len(DATAFLOW_REGISTRY) + 1)
