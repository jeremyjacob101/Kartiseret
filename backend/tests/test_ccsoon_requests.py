from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.comingsoons.CCsoon import CCsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class CinemaCityComingSoonRequestsTests(TestCase):
    def setUp(self):
        self.scraper = CCsoon.__new__(CCsoon)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.today_date = datetime(2026, 11, 4, 12)
        self.scraper.run_id = 42
        self.features = [
            self.feature("6674", "בויאונה: המפלצת מהאמזונס", "Beware Boiúna", "2026-11-05", 104.0, "הותר מגיל 14"),
            self.feature("6679", "שרק-חגיגות 25 שנה!-אנגלית", "Shrek (25 years)", "2026-11-04", 90.0, "מותר לכל"),
            self.feature("6085", "סרט שכבר יצא", "Released Film", "2026-10-29", 94.0, "מותר לכל"),
            self.feature("7001", "סרט-מדובב", "Dubbed Film", "2026-11-12", 90.0, "מותר לכל"),
            self.feature("7002", "סרט HFR", "HFR Film", "2026-11-12", 90.0, "מותר לכל"),
            self.feature("7003", "סרט-תלת מימד", None, "2026-11-12", None, "טרם נקבע"),
            self.feature("7004", "סינמה קידס", "Cinema Kids", "2026-11-12", 90.0, "מותר לכל"),
            self.feature("7005", "Cooking Show", "Cooking Show", "2026-11-12", 90.0, "מותר לכל"),
            self.feature(
                "7006", "Film with available sessions", "Film", "2026-11-05", 100.0, "מותר לכל",
                {"$date": "2026-11-05T12:00:00Z"},
            ),
        ]
        self.pages = [
            self.page(self.features[:4], 0, True, len(self.features)),
            self.page(self.features[4:], 4, False, len(self.features)),
        ]

    @staticmethod
    def feature(external_id, name, additional_name, release_date, duration, rating, closest_presentation=None):
        return {
            "id": f"source-{external_id}",
            "data": {
                "_id": f"source-{external_id}",
                "externalId": external_id,
                "name": name,
                "additionalName": additional_name,
                "dateStarted": {"$date": f"{release_date}T00:00:00Z"},
                "closestPresentationDateTime": closest_presentation,
                "duration": duration,
                "ratingName": rating,
            },
        }

    @staticmethod
    def page(items, offset, has_next, total=None):
        metadata = {"offset": offset, "hasNext": has_next, "count": len(items)}
        if total is not None:
            metadata["total"] = total
        return {"dataItems": items, "pagingMetadata": metadata}

    def run_collector(self):
        session = Mock()
        session.headers = {}
        home_response = Mock()
        home_response.text = '<html><script>{"x-wix-grid-app-id":"000a88a6-b713-4726-8e58-c32b652e8fd8"}</script></html>'
        token_response = Mock()
        token_response.json.return_value = {"apps": {"app": {"accessToken": "public-site-token"}}}
        session.get.side_effect = [home_response, token_response]

        def post(_url, *, json, **_kwargs):
            offset = json["query"]["paging"]["offset"]
            response = Mock()
            response.json.return_value = self.pages[0 if offset == 0 else 1]
            return response

        session.post.side_effect = post
        with (
            patch("backend.scraping.utils.CinemaCityRequests.requests.Session") as session_factory,
            patch("backend.scraping.utils.CinemaCityRequests.configure_scrape_session"),
        ):
            session_factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()
        return session

    def test_requests_are_preferred_but_selenium_remains_the_fallback(self):
        self.assertEqual(CCsoon.DEFAULT_SCRAPE_MODE, "auto")
        self.assertTrue(CCsoon.USES_BROWSER)

    def test_collects_and_validates_the_full_catalog_with_existing_title_rules(self):
        session = self.run_collector()
        rows = self.scraper.gathering_info

        self.assertEqual(len(session.post.call_args_list), 2)
        self.assertEqual(rows["hebrew_title"], [
            "בויאונה: המפלצת מהאמזונס",
            "שרק-חגיגות 25 שנה!",
            "סרט",
        ])
        self.assertEqual(rows["english_title"], ["Beware Boiúna", "Shrek (25 years)", "סרט"])
        self.assertEqual(rows["release_date"], ["2026-11-05", "2026-11-04", "2026-11-12"])
        self.assertEqual(rows["runtime"], [104, 90, None])
        self.assertEqual(rows["rating"], ["14+", "All", None])
        self.assertEqual(rows["showtime"], [None, None, None])
        self.assertEqual(rows["cinema"], ["Cinema City"] * 3)
        for optional_field in (
            "english_href",
            "hebrew_href",
            "screening_type",
            "screening_tech",
            "original_language",
            "dub_language",
            "date_of_showing",
            "release_year",
            "directed_by",
            "screening_city",
        ):
            self.assertEqual(rows[optional_field], [None] * 3, optional_field)
        self.assertEqual(self.scraper._coverage["features_expected"], 9)
        self.assertEqual(self.scraper._coverage["features_upcoming_expected"], 8)
        self.assertEqual(self.scraper._coverage["features_collected"], 3)
        self.assertEqual(self.scraper._coverage["features_skipped_before_today"], 1)
        self.assertEqual(self.scraper._coverage["features_skipped_with_presentations"], 1)
        self.assertEqual(self.scraper._coverage["features_skipped_by_title"], 4)
        self.assertEqual(self.scraper._coverage["collection_pages"], 2)

    def test_preserves_duplicate_output_rows_for_distinct_catalog_features(self):
        duplicate = self.feature(
            "7010", "Same Film", "Same Film", "2026-11-20", 95.0, "מותר לכל"
        )
        self.pages = [self.page([duplicate, {**duplicate, "id": "source-7011", "data": {
            **duplicate["data"], "_id": "source-7011", "externalId": "7011"
        }}], 0, False, 2)]

        self.run_collector()

        rows = self.scraper.gathering_info
        self.assertEqual(rows["hebrew_title"], ["Same Film", "Same Film"])
        self.assertEqual(rows["english_title"], ["Same Film", "Same Film"])
        self.assertEqual(rows["release_date"], ["2026-11-20", "2026-11-20"])

    def test_fails_closed_when_total_count_evidence_is_missing(self):
        self.pages = [self.page(self.features, 0, False)]

        with self.assertRaisesRegex(ValueError, "missing total-count paging evidence"):
            self.run_collector()

    def test_fails_closed_when_pagination_ends_before_reported_total(self):
        self.pages = [
            self.page(self.features[:2], 0, True, len(self.features)),
            self.page([], 2, False, len(self.features)),
        ]

        with self.assertRaisesRegex(ValueError, "pagination ended after 2 rows"):
            self.run_collector()

    def test_fails_closed_when_total_changes_between_pages(self):
        self.pages = [
            self.page(self.features[:2], 0, True, 8),
            self.page(self.features[2:], 2, False, 9),
        ]

        with self.assertRaisesRegex(ValueError, "total count changed during pagination"):
            self.run_collector()

    def test_fails_closed_for_missing_feature_id_or_release_date(self):
        for field, value, message in (
            ("externalId", None, "coming-soon feature id is missing"),
            ("dateStarted", None, "release date is missing"),
            ("dateStarted", {"$date": "2026-02-30T00:00:00Z"}, "release date is invalid"),
            ("closestPresentationDateTime", "not-a-date", "closest presentation date is invalid"),
        ):
            with self.subTest(field=field, value=value):
                malformed = {**self.features[0], "data": {**self.features[0]["data"], field: value}}
                self.pages = [self.page([malformed], 0, False, 1)]
                with self.assertRaisesRegex(ValueError, message):
                    self.run_collector()

    def test_fails_closed_when_presentation_status_evidence_is_missing(self):
        feature = {**self.features[0], "data": dict(self.features[0]["data"])}
        del feature["data"]["closestPresentationDateTime"]
        self.pages = [self.page([feature], 0, False, 1)]

        with self.assertRaisesRegex(ValueError, "missing presentation-status evidence"):
            self.run_collector()

    def test_complete_empty_catalog_is_explicitly_confirmed(self):
        self.pages = [self.page([], 0, False, 0)]

        self.run_collector()

        self.assertEqual(self.scraper.gathering_info["english_title"], [])
        self.assertIn("Complete SyncFeatures catalog", self.scraper._empty_snapshot_evidence)


if __name__ == "__main__":
    import unittest
    unittest.main()
