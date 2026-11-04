from types import SimpleNamespace
from unittest import TestCase

from backend.dataflow.cinematheques.CinemathequesUpdate import CinemathequesUpdate
from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate


class RottenTomatoesScoreTests(TestCase):
    def test_search_rejects_unrelated_same_year_and_prefers_title_match(self):
        from backend.dataflow.utils.RottenTomatoesScores import select_rotten_tomatoes_search_match

        html = '''<search-page-media-row release-year="2026"><a slot="title" href="/m/dune_part_three">Dune: Part Three</a></search-page-media-row>
        <search-page-media-row releaseyear="2026"><a slot="title" href="/m/matchmaking_3">Matchmaking 3</a></search-page-media-row>'''
        self.assertEqual(select_rotten_tomatoes_search_match(html, "Matchmaking 3", 2026), "https://www.rottentomatoes.com/m/matchmaking_3")
        self.assertIsNone(select_rotten_tomatoes_search_match(html, "The Beast", 2026))
        self.assertIsNone(select_rotten_tomatoes_search_match(html, "Matchmaking 3", 2020))

    def test_update_does_not_fetch_unrelated_movie_with_same_year(self):
        from unittest.mock import Mock

        html = '<search-page-media-row release-year="2026"><a slot="title" href="https://www.rottentomatoes.com/m/dune_part_three">Dune: Part Three</a></search-page-media-row>'
        for updater_type in (NowPlayingsUpdate, CinemathequesUpdate):
            with self.subTest(updater=updater_type.__name__):
                updater = updater_type.__new__(updater_type)
                updater.requests_headers = {}
                updater.requestGet = Mock(return_value=SimpleNamespace(text=html))
                existing = {"english_title": "Matchmaking 3", "release_year": 2026, "rt_id": ""}
                new_row = dict(existing)
                updater.updateRottenTomatoes(new_row, existing)
                self.assertEqual(updater.requestGet.call_count, 1)
                self.assertEqual(new_row["rt_id"], "")

    def test_replacing_listing_does_not_copy_previous_films_scores(self):
        search = '<search-page-media-row release-year="2026"><a slot="title" href="/m/matchmaking_3">Matchmaking 3</a></search-page-media-row>'
        page = '<script id="media-scorecard-json">{"criticsScore":{"score":80}}</script>'
        for updater_type in (NowPlayingsUpdate, CinemathequesUpdate):
            with self.subTest(updater=updater_type.__name__):
                updater = updater_type.__new__(updater_type)
                updater.requests_headers = {}
                updater.requestGet = lambda url, **kwargs: SimpleNamespace(text=search if "/search?" in url else page)
                existing = {"english_title": "Matchmaking 3", "release_year": 2026, "rt_id": "/m/dune_part_three", "rtCriticRating": 60, "rtCriticVotes": 22, "rtAudienceRating": 74, "rtAudienceVotes": 100}
                row = dict(existing)
                updater.updateRottenTomatoes(row, existing)
                self.assertEqual(row["rt_id"], "/m/matchmaking_3")
                self.assertEqual(row["rtCriticRating"], 80)
                self.assertIsNone(row["rtAudienceRating"])
                self.assertIsNone(row["rtAudienceVotes"])
                self.assertIsNone(row["rtCriticVotes"])

    def test_update_flows_preserve_numeric_zero_scores_and_counts(self):
        search_html = '<search-page-media-row release-year="2024"><a slot="title" href="https://www.rottentomatoes.com/m/example">Example Film</a></search-page-media-row>'
        page_html = '''<script id="media-scorecard-json">
            {"criticsScore":{"score":0,"ratingCount":0},
             "audienceScore":{"score":0,"bandedRatingCount":0}}
        </script>'''

        for updater_type in (NowPlayingsUpdate, CinemathequesUpdate):
            with self.subTest(updater=updater_type.__name__):
                updater = updater_type.__new__(updater_type)
                updater.requests_headers = {}
                updater.requestGet = lambda url, **_kwargs: SimpleNamespace(
                    text=search_html if "/search?" in url else page_html
                )
                existing = {
                    "english_title": "Example Film",
                    "release_year": 2024,
                    "rt_id": "",
                    "rtCriticRating": 91,
                    "rtCriticVotes": 300,
                    "rtAudienceRating": 82,
                    "rtAudienceVotes": 400,
                }
                new_row = dict(existing)

                updater.updateRottenTomatoes(new_row, existing)

                self.assertEqual(new_row["rtCriticRating"], 0)
                self.assertEqual(new_row["rtCriticVotes"], 0)
                self.assertEqual(new_row["rtAudienceRating"], 0)
                self.assertEqual(new_row["rtAudienceVotes"], 0)

    def test_missing_scorecard_values_preserve_existing_values(self):
        search_html = '<search-page-media-row release-year="2024"><a slot="title" href="https://www.rottentomatoes.com/m/example">Example Film</a></search-page-media-row>'
        page_html = '<script id="media-scorecard-json">{}</script>'

        for updater_type in (NowPlayingsUpdate, CinemathequesUpdate):
            with self.subTest(updater=updater_type.__name__):
                updater = updater_type.__new__(updater_type)
                updater.requests_headers = {}
                updater.requestGet = lambda url, **_kwargs: SimpleNamespace(
                    text=search_html if "/search?" in url else page_html
                )
                existing = {
                    "english_title": "Example Film",
                    "release_year": 2024,
                    "rt_id": "",
                    "rtCriticRating": 91,
                    "rtCriticVotes": 300,
                    "rtAudienceRating": 82,
                    "rtAudienceVotes": 400,
                }
                new_row = dict(existing)

                updater.updateRottenTomatoes(new_row, existing)

                for field in ("rtCriticRating", "rtCriticVotes", "rtAudienceRating", "rtAudienceVotes"):
                    self.assertEqual(new_row[field], existing[field])


if __name__ == "__main__":
    from unittest import main

    main()
