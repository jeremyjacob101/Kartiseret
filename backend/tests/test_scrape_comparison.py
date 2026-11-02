from unittest import TestCase

from backend.scraping.compare import compare_rows, rows_from_columns


class ScrapeComparisonTests(TestCase):
    def test_checks_duplicates_types_and_every_data_field(self):
        left = rows_from_columns({'title': ['Film', 'Film'], 'runtime': [90, 90], 'run_id': [1, 1]})
        right = rows_from_columns({'title': ['Film', 'Film'], 'runtime': [90, '90'], 'run_id': [2, 2]})
        result = compare_rows(left, right)
        self.assertEqual(result['matched'], 1)
        self.assertEqual(result['selenium_only'][0]['row']['runtime'], 90)
        self.assertEqual(result['requests_only'][0]['row']['runtime'], '90')

    def test_rejects_unequal_columns_instead_of_silently_dropping_rows(self):
        with self.assertRaises(ValueError):
            rows_from_columns({'title': ['Film'], 'showtime': []})

    def test_exact_comparison_is_independent_of_order(self):
        a = [{'title': 'A'}, {'title': 'B'}, {'title': 'A'}]
        result = compare_rows(a, list(reversed(a)))
        self.assertEqual(result['matched'], 3)
        self.assertEqual(result['selenium_only'], [])
        self.assertEqual(result['requests_only'], [])
