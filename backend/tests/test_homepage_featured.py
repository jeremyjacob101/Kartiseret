from datetime import datetime, timezone
import unittest
from unittest.mock import Mock

from backend.dataflow.homepage_featured import (
    choose_weekly_candidates,
    israel_week_start,
    refresh_weekly_homepage_lineup,
)


class HomepageFeaturedLineupTests(unittest.TestCase):
    def test_week_starts_on_thursday_in_israel_even_when_utc_is_wednesday(self):
        after_israel_midnight = datetime(2026, 11, 18, 22, 30, tzinfo=timezone.utc)
        before_israel_midnight = datetime(2026, 11, 18, 21, 0, tzinfo=timezone.utc)

        self.assertEqual(israel_week_start(after_israel_midnight), "2026-11-19")
        self.assertEqual(israel_week_start(before_israel_midnight), "2026-11-12")

    def test_candidates_are_ranked_and_ineligible_rows_are_ignored(self):
        now_playing = [
            {"tmdb_id": 11, "release_year": 2026, "popularity": 70, "en_poster": "/11.jpg"},
            {"tmdb_id": 12, "release_year": 2025, "popularity": 80, "backdrop": "/12.jpg"},
            {"tmdb_id": 13, "release_year": 2022, "popularity": 95, "en_poster": "/13.jpg"},
            {"tmdb_id": 14, "release_year": 2026, "popularity": 500, "solo_update": True, "en_poster": "/14.jpg"},
            {"tmdb_id": 15, "release_year": 2026, "popularity": 400},
        ]
        coming_soon = [
            {"tmdb_id": 21, "release_date": "2026-12-01", "popularity": 20, "en_poster": "/21.jpg"},
            {"tmdb_id": 22, "release_date": "2026-11-30", "popularity": 10, "backdrop": "/22.jpg"},
            {"tmdb_id": 23, "release_date": "2026-11-30", "popularity": 10, "en_poster": "/23.jpg"},
            {"tmdb_id": 24, "release_date": "2026-11-29", "popularity": 100, "solo_update": True, "en_poster": "/24.jpg"},
        ]

        now_playing_ids, coming_soon_ids = choose_weekly_candidates(
            now_playing, coming_soon, current_year=2026
        )

        self.assertEqual(now_playing_ids, [12, 11, 13])
        self.assertEqual(coming_soon_ids, [22, 23, 21])

    def test_existing_weekly_lineup_skips_the_catalog_scan(self):
        client = Mock()
        query = client.table.return_value.select.return_value.eq.return_value.limit
        query.return_value.execute.return_value.data = [
            {"now_playing_ids": [1, 2], "coming_soon_ids": [3]},
        ]

        result = refresh_weekly_homepage_lineup(
            client, datetime(2026, 11, 20, tzinfo=timezone.utc)
        )

        self.assertEqual(result, {"week_start": "2026-11-19", "now_playing": 2, "coming_soon": 1})
        client.table.assert_called_once_with("homepage_featured_weekly_lineups")
        client.table.return_value.upsert.assert_not_called()

    def test_candidate_reserve_lists_are_bounded(self):
        rows = [
            {"tmdb_id": movie_id, "release_year": 2026, "popularity": movie_id, "en_poster": f"/{movie_id}.jpg"}
            for movie_id in range(1, 51)
        ]

        now_playing_ids, coming_soon_ids = choose_weekly_candidates(rows, rows, 2026)

        self.assertEqual(len(now_playing_ids), 40)
        self.assertEqual(len(coming_soon_ids), 40)


if __name__ == "__main__":
    unittest.main()
