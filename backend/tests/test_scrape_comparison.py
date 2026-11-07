from unittest import TestCase
from unittest.mock import patch

from backend.scraping.compare import collect, compare_rows, rows_from_columns
from backend.scraping.nowplayings.LevCinema import LevCinema


class ScrapeComparisonTests(TestCase):
    def test_harness_runs_production_validation_without_browser_or_database(self):
        def incomplete(scraper):
            scraper.english_title = 'Film'
            scraper.date_of_showing = '2026-11-07'
            scraper.showtime = '20:00'
            scraper.screening_city = 'Tel Aviv'
            scraper.english_href = 'https://example.test/ticket/1'
            scraper.appendToGatheringInfo()
            scraper._coverage = {'pages_expected': 2, 'pages_completed': 1}
        with patch.object(LevCinema, 'requests_logic', incomplete), \
             patch('backend.scraping.compare.build_chrome') as chrome, \
             patch('backend.scraping.BaseCinema.setUpSupabase') as database:
            result = collect(LevCinema, 'requests')
        self.assertEqual(result['status'], 'error')
        self.assertIn('coverage', result['error'])
        self.assertEqual(len(result['partial_rows']), 1)
        chrome.assert_not_called()
        database.assert_not_called()

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
