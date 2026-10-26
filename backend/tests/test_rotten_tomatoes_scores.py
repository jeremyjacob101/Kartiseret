from types import SimpleNamespace
from unittest import TestCase

from backend.dataflow.cinematheques.CinemathequesUpdate import CinemathequesUpdate
from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate


class RottenTomatoesScoreTests(TestCase):
    def test_update_flows_preserve_numeric_zero_scores_and_counts(self):
        search_html = '<search-page-media-row release-year="2024"><a href="https://www.rottentomatoes.com/m/example"></a></search-page-media-row>'
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
        search_html = '<search-page-media-row release-year="2024"><a href="https://www.rottentomatoes.com/m/example"></a></search-page-media-row>'
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
