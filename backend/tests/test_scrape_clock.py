from datetime import datetime
from unittest import TestCase
from unittest.mock import patch

import pytz

from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class ScrapeClockTests(TestCase):
    def test_jerusalem_date_and_month_share_one_instant(self):
        instant = pytz.UTC.localize(datetime(2026, 12, 31, 22, 30))
        with patch('backend.scraping.utils.InitializeBaseCinema.datetime') as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            state = InitializeBaseCinema()
        clock.now.assert_called_once()
        self.assertEqual(state.today_date, datetime(2027, 1, 1, 0, 30))
        self.assertEqual(state.current_year, '2027')
        self.assertEqual(state.current_month, '1')
