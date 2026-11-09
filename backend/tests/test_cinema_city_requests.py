from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from backend.scraping.nowplayings.CinemaCity import CinemaCity
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema
from backend.scraping.utils.CinemaCityRequests import _event_datetime


class CinemaCityRequestsTests(TestCase):
    def test_requests_are_preferred_with_automatic_selenium_fallback(self):
        self.assertEqual(CinemaCity.DEFAULT_SCRAPE_MODE, "auto")

    def setUp(self):
        self.scraper = CinemaCity.__new__(CinemaCity)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.today_date = datetime(2026, 11, 4, 12)
        self.scraper.run_id = 42

        # The shape mirrors Wix's public cloud-data response: source records
        # wrap their fields under data, and dates use Wix's {$date: ...} form.
        self.locations = [
            {
                "id": "city-glilot",
                "data": {"_id": "city-glilot", "name": "Glilot", "hebrewName": "סינמה סיטי גלילות",
                         "active": True, "hasPresentations": True},
            },
            {
                "id": "city-beer-sheva",
                "data": {"_id": "city-beer-sheva", "name": "Beer Sheva", "hebrewName": "סינמה סיטי באר שבע",
                         "active": True, "hasPresentations": True},
            },
            {
                "id": "city-jerusalem",
                "data": {"_id": "city-jerusalem", "name": "Jerusalem", "hebrewName": "סינמה סיטי ירושלים",
                         "active": True, "hasPresentations": True},
            },
        ]
        self.features = [
            {
                "id": "feature-shrek",
                "data": {"_id": "feature-shrek", "externalId": "6680",
                         "name": "שרק-חגיגות 25 שנה!-מדובב", "additionalName": "Shrek (25 years)",
                         "duration": 90.0, "ratingName": "מותר לכל"},
            },
            {
                "id": "feature-hfr",
                "data": {"_id": "feature-hfr", "externalId": "6606",
                         "name": "החיה HFR תלת מימד", "additionalName": "The Beast",
                         "duration": 99.0, "ratingName": "הותר מגיל 14"},
            },
            {
                "id": "feature-excluded",
                "data": {"_id": "feature-excluded", "externalId": "6500",
                         "name": "סרט בתרגום לצרפתית", "additionalName": "Film",
                         "duration": 90.0, "ratingName": "מותר לכל"},
            },
        ]
        self.presentations = [
            {
                "id": "event-1",
                "data": {"_id": "event-1", "externalId": "894756", "featureId": 6680.0,
                         "locationName": "סינמה סיטי באר שבע", "venueTypeName": "רגיל",
                         "dateTime": "2026-11-10 15:50", "businessDate": {"$date": "2026-11-10T00:00:00Z"}},
            },
            {
                "id": "event-2",
                "data": {"_id": "event-2", "externalId": "894857", "featureId": 6606.0,
                         "locationName": "סינמה סיטי גלילות", "venueTypeName": "ONYX",
                         "dateTime": "2026-11-05 01:15", "businessDate": {"$date": "2026-11-04T00:00:00Z"}},
            },
            {
                "id": "event-3",
                "data": {"_id": "event-3", "externalId": "894858", "featureId": 6500.0,
                         "locationName": "סינמה סיטי ירושלים", "venueTypeName": "VIP",
                         "dateTime": "2026-11-05 18:30", "businessDate": {"$date": "2026-11-05T00:00:00Z"}},
            },
            {
                "id": "event-4",
                "data": {"_id": "event-4", "externalId": "894859", "featureId": 6680.0,
                         "locationName": "סינמה סיטי גלילות", "venueTypeName": "רגיל",
                         "dateTime": "2026-11-04 11:59", "businessDate": {"$date": "2026-11-04T00:00:00Z"}},
            },
        ]
        self.pages = {
            "CityDynamicPage": [self.page(self.locations, 0, False)],
            "SyncFeatures": [self.page(self.features, 0, False)],
            "SyncPresentations": [
                self.page(self.presentations[:2], 0, True),
                self.page(self.presentations[2:], 2, False),
            ],
        }

    @staticmethod
    def page(items, offset, has_next):
        return {
            "dataItems": items,
            "pagingMetadata": {"offset": offset, "hasNext": has_next, "count": len(items)},
        }

    def run_collector(self):
        session = Mock()
        session.headers = {}
        home_response = Mock()
        home_response.text = '<html><script>{"x-wix-grid-app-id":"000a88a6-b713-4726-8e58-c32b652e8fd8"}</script></html>'
        token_response = Mock()
        token_response.json.return_value = {"apps": {"app": {"accessToken": "public-site-token"}}}
        session.get.side_effect = [home_response, token_response]

        def post(_url, *, json, **_kwargs):
            collection = json["dataCollectionId"]
            offset = json["query"]["paging"]["offset"]
            page_index = 0 if offset == 0 else 1
            response = Mock()
            response.json.return_value = self.pages[collection][page_index]
            return response

        session.post.side_effect = post
        with (
            patch("backend.scraping.utils.CinemaCityRequests.requests.Session") as session_factory,
            patch("backend.scraping.utils.CinemaCityRequests.configure_scrape_session"),
        ):
            session_factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()
        return session

    def test_collects_all_pages_and_preserves_existing_cinema_city_output(self):
        session = self.run_collector()
        rows = self.scraper.gathering_info
        self.assertEqual(len(session.post.call_args_list), 4)
        self.assertEqual(rows["hebrew_title"], ["שרק-חגיגות 25 שנה!", "החיה"])
        self.assertEqual(rows["english_title"], ["Shrek (25 years)", "The Beast"])
        self.assertEqual(rows["runtime"], [90, 99])
        self.assertEqual(rows["rating"], ["All", "14+"])

        self.assertEqual(rows["screening_city"], ["Beer Sheva", "Glilot"])
        self.assertEqual(rows["screening_type"], ["Regular", "Regular"])
        self.assertEqual(rows["screening_tech"], ["2D", "3D HFR ONYX"])
        self.assertEqual(rows["dub_language"], ["Hebrew", None])
        self.assertEqual(rows["date_of_showing"], ["2026-11-10", "2026-11-04"])
        self.assertEqual(rows["showtime"], ["15:50", "01:15"])
        self.assertEqual(rows["english_href"], [
            "https://tickets.cinema-city.co.il/order/894756?lang=en",
            "https://tickets.cinema-city.co.il/order/894857?lang=en",
        ])
        self.assertEqual(self.scraper._coverage["presentations_expected"], 4)
        self.assertEqual(self.scraper._coverage["presentations_collected"], 2)
        self.assertEqual(self.scraper._coverage["presentations_skipped_by_title"], 1)
        self.assertEqual(self.scraper._coverage["presentations_skipped_expired"], 1)
        self.assertEqual(self.scraper._coverage["collection_pages"]["SyncPresentations"], 2)

    def test_preserves_unassigned_and_published_age_restrictions(self):
        # Actual source values seen before/after the 2026-11-09 update. A new
        # attempt must read the current value without retaining an older age
        # restriction or leaking it into the next film's screenings.
        for source_value, expected in (("טרם נקבע", None), ("מותר לכל", "All"), ("הותר מגיל 9", "9+")):
            with self.subTest(age_restriction=source_value):
                self.setUp()
                self.features[0]["data"]["ratingName"] = source_value
                self.run_collector()
                self.assertEqual(self.scraper.gathering_info["rating"], [expected, "14+"])

    def test_excludes_a_screening_at_the_frozen_local_scrape_instant(self):
        event_at_scrape_time = {
            **self.presentations[0],
            "data": {
                **self.presentations[0]["data"],
                "dateTime": "2026-11-04 12:00",
                "businessDate": {"$date": "2026-11-04T00:00:00Z"},
            },
        }
        self.pages["SyncPresentations"] = [self.page([event_at_scrape_time], 0, False)]

        self.run_collector()

        self.assertEqual(self.scraper.gathering_info["showtime"], [])
        self.assertEqual(self.scraper._coverage["presentations_skipped_expired"], 1)
        self.assertIn("expired=1", self.scraper._empty_snapshot_evidence)

    def test_converts_explicit_utc_event_times_to_jerusalem_local_time(self):
        event_datetime = _event_datetime("2026-11-04T15:50:00Z")

        self.assertEqual(event_datetime.hour, 17)
        self.assertEqual(event_datetime.minute, 50)
        self.assertEqual(event_datetime.tzinfo, ZoneInfo("Asia/Jerusalem"))

    def test_fails_closed_for_unknown_feature_location_or_room_type(self):
        for field, value, message in (
            ("featureId", 9999, "undiscovered feature"),
            ("locationName", "Cinema City Mars", "undiscovered location"),
            ("venueTypeName", "IMAX", "unmapped room type"),
        ):
            with self.subTest(field=field):
                self.pages["SyncPresentations"] = [
                    self.page([dict(self.presentations[0], data={**self.presentations[0]["data"], field: value})], 0, False)
                ]
                with self.assertRaisesRegex(ValueError, message):
                    self.run_collector()
                InitializeBaseCinema.__init__(self.scraper)

    def test_deduplicates_same_selector_time_but_keeps_the_first_ticket_event(self):
        duplicate = {
            "id": "event-1-duplicate",
            "data": {
                **self.presentations[0]["data"],
                "_id": "event-1-duplicate",
                "externalId": "894757",
            },
        }
        self.pages["SyncPresentations"] = [
            self.page([*self.presentations, duplicate], 0, False),
        ]

        self.run_collector()

        rows = self.scraper.gathering_info
        self.assertEqual(len(rows["showtime"]), 2)
        self.assertEqual(rows["english_href"][0], "https://tickets.cinema-city.co.il/order/894756?lang=en")
        self.assertEqual(self.scraper._coverage["duplicate_showtime_options_skipped"], 1)
        self.assertEqual(
            self.scraper._coverage["presentations_expected"],
            self.scraper._coverage["presentations_collected"]
            + self.scraper._coverage["presentations_skipped_by_title"]
            + self.scraper._coverage["presentations_skipped_expired"]
            + self.scraper._coverage["duplicate_event_ids_skipped"]
            + self.scraper._coverage["duplicate_showtime_options_skipped"],
        )

    def test_fails_if_later_page_is_missing_even_after_valid_rows(self):
        self.pages["SyncPresentations"] = [self.page(self.presentations[:2], 0, True), self.page([], 2, True)]
        with self.assertRaisesRegex(ValueError, "pagination stalled"):
            self.run_collector()

    def test_fails_if_source_pagination_repeats_the_same_row(self):
        repeated = self.presentations[0]
        self.pages["SyncPresentations"] = [
            self.page([repeated], 0, True),
            self.page([repeated], 1, False),
        ]
        with self.assertRaisesRegex(ValueError, "repeated a source row"):
            self.run_collector()


if __name__ == "__main__":
    import unittest
    unittest.main()
