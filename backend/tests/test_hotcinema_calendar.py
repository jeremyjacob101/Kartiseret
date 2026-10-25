import unittest

from backend.scraping.nowplayings.HotCinema import _is_unselectable_date_cell


class HotCinemaCalendarTests(unittest.TestCase):
    def test_skips_disabled_and_adjacent_month_cells_regardless_of_class_order(self):
        for class_name in (
            "old active day disabled",
            "active day disabled",
            "day disabled",
            "old day disabled",
            "new day disabled",
            "old day",
            "new day",
        ):
            with self.subTest(class_name=class_name):
                self.assertTrue(_is_unselectable_date_cell(class_name))

    def test_keeps_selectable_current_month_days(self):
        for class_name in ("day", "active day"):
            with self.subTest(class_name=class_name):
                self.assertFalse(_is_unselectable_date_cell(class_name))


if __name__ == "__main__":
    unittest.main()
