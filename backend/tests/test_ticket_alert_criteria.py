import unittest
from datetime import datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from backend.notifications.ticket_alerts import (
    ALERT_FILTER_OPTIONS,
    TicketAlertConfig,
    TicketAlertDispatcher,
    DeliveryItem,
    FILTER_BIT_ASSIGNMENTS,
    _encode_filter_mask,
    build_movie_showtime_path,
    build_ticket_alert_path,
    create_public_route_link_paths,
    delivery_item_from_snapshot,
    filter_mask_from_exclusions,
    movie_showtime_share_key,
    matches_ticket_alert_criteria,
    render_ticket_alert_email,
    resolve_ticket_alert_criteria,
    select_linked_showtime,
)


DEFAULTS = {
    "cities": None,
    "filters": {
        "showType": [],
        "screenFormat": [],
        "screeningTech": [],
        "dubLanguage": [],
    },
}
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=ZoneInfo("Asia/Jerusalem"))


def showtime(tmdb_id=101, **changes):
    row = {
        "tmdb_id": tmdb_id,
        "english_title": f"Film {tmdb_id}",
        "screening_city": "Jerusalem",
        "date_of_showing": "2026-10-22",
        "showtime": "20:00",
        "cinema": "Cinema City",
        "english_href": f"https://tickets.example.test/{tmdb_id}",
        "hebrew_href": None,
        "screening_type": "Regular",
        "screening_tech": "2D",
        "dub_language": "Original",
    }
    return {**row, **changes}


class TicketAlertCriteriaTests(unittest.TestCase):
    def test_public_notification_route_requests_are_chunked_with_order_preserved(self):
        class RouteResponse:
            status_code = 200

            def __init__(self, payload):
                self.payload = payload

            def json(self):
                return {
                    "data": {
                        "moviePaths": ["/a0000000"] * len(self.payload["movieCodes"]),
                        "pagePaths": ["/b0000000"] * len(self.payload["pagePaths"]),
                        "sharePaths": ["/c0000000"] * len(self.payload["shares"]),
                    }
                }

        class RouteClient:
            def __init__(self):
                self.payloads = []

            def post(self, _url, *, json, **_kwargs):
                self.payloads.append(json)
                return RouteResponse(json)

        client = RouteClient()
        links = create_public_route_link_paths(
            client,
            base_url="https://api.example.test",
            internal_secret="internal-test-secret",
            movie_codes=[f"M{index:02d}" for index in range(50)],
            page_paths=[f"/page-{index}" for index in range(10)],
            shares=[{"movieCode": "Ab1"} for _ in range(50)],
        )

        self.assertEqual(len(client.payloads), 2)
        self.assertEqual(
            [
                len(client.payloads[0]["movieCodes"]),
                len(client.payloads[0]["pagePaths"]),
                len(client.payloads[0]["shares"]),
            ],
            [50, 10, 40],
        )
        self.assertEqual(
            [
                len(client.payloads[1]["movieCodes"]),
                len(client.payloads[1]["pagePaths"]),
                len(client.payloads[1]["shares"]),
            ],
            [0, 0, 10],
        )
        self.assertEqual(len(links["moviePaths"]), 50)
        self.assertEqual(len(links["pagePaths"]), 10)
        self.assertEqual(len(links["sharePaths"]), 50)

    def test_shared_showtime_link_vectors_match_typescript_contract(self):
        vectors_path = (
            Path(__file__).resolve().parents[2]
            / "packages/contracts/test-data/showtime-link-vectors.json"
        )
        vectors = json.loads(vectors_path.read_text())
        for vector in vectors:
            with self.subTest(path=vector["path"]):
                self.assertEqual(
                    filter_mask_from_exclusions(vector["filterExclusions"]),
                    vector["filterMask"],
                )
                self.assertEqual(
                    build_ticket_alert_path(
                        vector["movieCode"],
                        vector["city"],
                        vector["date"],
                        NOW.date(),
                        vector["filterExclusions"],
                    ),
                    vector["path"],
                )

    def test_ticket_alert_email_links_to_movie_page_with_snapshot_preferences(self):
        item = DeliveryItem(
            tmdb_id=101,
            title="Future Film",
            city="Tel Aviv",
            date="2027-01-15",
            ticket_href="https://tickets.example.test/101",
            movie_code="A7z",
            filter_mask=45120,
        )
        email = render_ticket_alert_email(
            (item,),
            "https://seret.site",
            {movie_showtime_share_key("A7z", "Tel Aviv", "2027-01-15", 45120): "/abcd1234"},
        )
        self.assertIn("View showtimes", email.html)
        self.assertIn("View showtimes:", email.text)
        self.assertIn("https://seret.site/abcd1234", email.text)
        self.assertNotIn("tickets.example.test", email.html)
        self.assertNotIn("tickets.example.test", email.text)

    def test_retried_snapshot_preserves_infinity_vision_in_the_email_link(self):
        item = delivery_item_from_snapshot(
            {
                "tmdb_id": 101,
                "delivery_title": "Future Film",
                "delivery_city": "Tel Aviv",
                "delivery_date": "2027-01-15",
                "delivery_href": "https://tickets.example.test/101",
                "delivery_movie_code": "A7z",
                "delivery_filter_mask": 2**20,
            }
        )
        self.assertIsNotNone(item)
        email = render_ticket_alert_email(
            (item,),
            "https://seret.site",
            {movie_showtime_share_key("A7z", "Tel Aviv", "2027-01-15", 2**20): "/efgh5678"},
        )
        self.assertIn("https://seret.site/efgh5678", email.text)

    def test_legacy_delivery_snapshot_defaults_missing_filter_mask(self):
        item = delivery_item_from_snapshot(
            {
                "tmdb_id": 101,
                "delivery_title": "Future Film",
                "delivery_city": "Jerusalem",
                "delivery_date": "2026-10-22",
                "delivery_href": "https://tickets.example.test/101",
                "delivery_movie_code": None,
            }
        )
        self.assertIsNotNone(item)
        self.assertEqual(item.filter_mask, 0)
        email = render_ticket_alert_email(
            (item,), "https://seret.site", {("page", "/showtimes"): "/pqrs9876"}
        )
        self.assertIn('href="https://seret.site/pqrs9876"', email.html)
        self.assertNotIn("tickets.example.test", email.html)

    def test_retry_enriches_an_old_snapshot_movie_code_without_using_ticket_href(self):
        class Repository:
            def __init__(self):
                self.sent = None

            def load_pending_subscriptions(self):
                return [
                    {
                        "user_id": "alice",
                        "tmdb_id": 101,
                        "created_at": "2026-10-20T10:00:00Z",
                        "delivery_id": "old-delivery",
                        "delivery_title": "Future Film",
                        "delivery_city": "Tel Aviv",
                        "delivery_date": "2027-01-15",
                        "delivery_href": "https://tickets.example.test/booking",
                        "delivery_movie_code": None,
                        "notified_at": None,
                    }
                ]

            def load_movie_codes(self, tmdb_ids):
                self.asserted_ids = tmdb_ids
                return {101: "A7z"}

            def record_attempt(self, *_args):
                pass

            def canonical_email(self, _user_id):
                return "alice@example.test"

            def mark_success(self, *_args):
                pass

            def mark_failure(self, *_args):
                raise AssertionError("The legacy delivery should remain deliverable")

        class Response:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"id": "resend-1"}

        class Resend:
            def __init__(self):
                self.payload = None

            def post(self, url, *, json, **_kwargs):
                self.payload = json
                if url.endswith("/api/internal/public-route-links"):
                    return type("RouteResponse", (), {
                        "status_code": 200,
                        "json": staticmethod(lambda: {
                            "data": {
                                "moviePaths": [],
                                "pagePaths": [],
                                "sharePaths": ["/abcd1234"],
                            }
                        }),
                    })()
                return Response()

        repository = Repository()
        resend = Resend()
        dispatcher = TicketAlertDispatcher(
            1,
            repository=repository,
            http_client=resend,
            config=TicketAlertConfig(
                resend_api_key="fake",
                from_email="alerts@example.test",
                site_url="https://seret.site",
                recipient_api_url="https://api.example.test",
                internal_api_secret="internal-test-secret",
            ),
            now_factory=lambda: NOW,
        )

        summary = dispatcher.dispatch()

        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(repository.asserted_ids, [101])
        self.assertIn(
            "https://seret.site/abcd1234",
            resend.payload["text"],
        )
        self.assertNotIn("tickets.example.test", resend.payload["html"])

    def test_bat_yam_ticket_alerts_use_the_city_short_link(self):
        path = build_ticket_alert_path(
            "ABC",
            "Bat Yam",
            "2026-10-22",
            NOW.date(),
        )
        self.assertTrue(path.startswith("/ABCc"))

    def test_defaults_use_jerusalem_and_filters_allow_early_showings(self):
        row = showtime(
            screening_city="Jerusalem",
            date_of_showing="2026-10-22",
            showtime="10:00",
            screening_type="Regular",
        )
        self.assertTrue(matches_ticket_alert_criteria(row, DEFAULTS))
        self.assertEqual(
            select_linked_showtime([row], NOW, DEFAULTS).city,
            "Jerusalem",
        )

    def test_unrestricted_show_type_includes_unknown_one_off_labels(self):
        row = showtime(screening_type="One-off Screening")
        self.assertTrue(matches_ticket_alert_criteria(row, DEFAULTS))
        filtered = {
            **DEFAULTS,
            "filters": {**DEFAULTS["filters"], "showType": ["Regular"]},
        }
        self.assertFalse(matches_ticket_alert_criteria(row, filtered))

    def test_infinity_vision_is_excluded_as_its_own_screening_tech(self):
        row = showtime(screening_tech="2D Infinity Vision")
        criteria = {
            **DEFAULTS,
            "filters": {
                **DEFAULTS["filters"],
                "screeningTech": ["Infinity Vision"],
            },
        }

        self.assertFalse(matches_ticket_alert_criteria(row, criteria))

    def test_infinity_vision_combinations_preserve_their_other_tech_filters(self):
        combinations = (
            ("2D ScreenX Infinity Vision", "ScreenX"),
            ("2D 4DX Infinity Vision", "4DX"),
            ("2D Atmos Infinity Vision", "Atmos"),
            ("3D 4DX Infinity Vision", "4DX"),
        )

        for screening_tech, other_tech in combinations:
            with self.subTest(screening_tech=screening_tech):
                row = showtime(screening_tech=screening_tech)
                excluded_other_tech = {
                    **DEFAULTS,
                    "filters": {
                        **DEFAULTS["filters"],
                        "screeningTech": [other_tech],
                    },
                }
                excluded_infinity_vision = {
                    **DEFAULTS,
                    "filters": {
                        **DEFAULTS["filters"],
                        "screeningTech": ["Infinity Vision"],
                    },
                }

                self.assertTrue(
                    matches_ticket_alert_criteria(row, excluded_other_tech)
                )
                self.assertTrue(
                    matches_ticket_alert_criteria(row, excluded_infinity_vision)
                )

    def test_infinity_vision_share_links_match_the_shared_codec_vector(self):
        self.assertIn("Infinity Vision", ALERT_FILTER_OPTIONS["screeningTech"])
        self.assertIn(
            (20, "screeningTech", "Infinity Vision"),
            FILTER_BIT_ASSIGNMENTS,
        )
        self.assertEqual(_encode_filter_mask(2**20), "I6Og")
        self.assertIsNone(_encode_filter_mask(2**21))

        vector = {
            "movieCode": "A7z",
            "city": "Tel Aviv",
            "date": "2027-01-15",
            "filterExclusions": {
                "showType": [],
                "screenFormat": [],
                "screeningTech": ["Infinity Vision"],
                "dubLanguage": [],
            },
            "filterMask": 2**20,
            "path": "/A7zlbI6Og?date=2027-01-15",
        }

        self.assertEqual(
            filter_mask_from_exclusions(vector["filterExclusions"]),
            vector["filterMask"],
        )
        self.assertEqual(
            build_ticket_alert_path(
                vector["movieCode"],
                vector["city"],
                vector["date"],
                NOW.date(),
                vector["filterExclusions"],
            ),
            vector["path"],
        )

    def test_sparse_title_overrides_inherit_each_other_default(self):
        defaults = {
            "cities": ["Haifa", "Jerusalem"],
            "filters": {
                "showType": ["Premium"],
                "screenFormat": ["3D"],
                "screeningTech": ["IMAX"],
                "dubLanguage": ["French"],
            },
        }
        self.assertEqual(
            resolve_ticket_alert_criteria(
                defaults,
                {"cities": ["Jerusalem"], "filters": {"screeningTech": []}},
            ),
            {
                "cities": ["Jerusalem"],
                "notificationMode": "first_any_city",
                "filters": {
                    "showType": ["Premium"],
                    "screenFormat": ["3D"],
                    "screeningTech": [],
                    "dubLanguage": ["French"],
                },
            },
        )

    def test_explicit_city_set_never_falls_back_to_another_city(self):
        only_haifa = showtime(screening_city="Haifa")
        criteria = {**DEFAULTS, "cities": ["Jerusalem", "Tel Aviv"]}
        self.assertFalse(matches_ticket_alert_criteria(only_haifa, criteria))
        self.assertIsNone(select_linked_showtime([only_haifa], NOW, criteria))

    def test_each_filter_group_and_missing_metadata_use_existing_showtime_rules(self):
        cases = [
            ("showType", "Regular", {"screening_type": "Regular"}),
            ("screenFormat", "3D", {"screening_tech": "3D"}),
            ("screeningTech", "IMAX", {"screening_tech": "IMAX"}),
            ("dubLanguage", "Hebrew", {"dub_language": "Hebrew"}),
        ]
        for group, value, metadata in cases:
            with self.subTest(group=group):
                criteria = {**DEFAULTS, "filters": {**DEFAULTS["filters"], group: [value]}}
                self.assertFalse(matches_ticket_alert_criteria(showtime(**metadata), criteria))

        self.assertTrue(matches_ticket_alert_criteria(
            showtime(screening_type=None, screening_tech=None, dub_language=None),
            DEFAULTS,
        ))

    def test_ticket_links_remain_required(self):
        self.assertIsNone(
            select_linked_showtime(
                [showtime(english_href="javascript:alert(1)", hebrew_href=None)],
                NOW,
                DEFAULTS,
            )
        )

    def test_dispatch_groups_matching_titles_once_per_account(self):
        class Repository:
            def load_showtimes(self, tmdb_ids, _earliest_date):
                return [showtime(tmdb_id) for tmdb_id in tmdb_ids]

            def load_titles(self, tmdb_ids):
                return {tmdb_id: f"Film {tmdb_id}" for tmdb_id in tmdb_ids}

            def load_movie_codes(self, _tmdb_ids):
                return {}

            def load_ticket_alert_preferences(self, _user_ids):
                return {}

            def claim_delivery(self, user_id, delivery_id, items):
                return [
                    {
                        "user_id": user_id,
                        "tmdb_id": item.tmdb_id,
                        "delivery_id": delivery_id,
                        "delivery_title": item.title,
                        "delivery_city": item.city,
                        "delivery_date": item.date,
                        "delivery_href": item.ticket_href,
                    }
                    for item in items
                ]

        dispatcher = TicketAlertDispatcher(
            1,
            repository=Repository(),
            config=TicketAlertConfig("", "", "https://seret.site"),
            now_factory=lambda: NOW,
            delivery_id_factory=lambda: "delivery-1",
        )
        pending = [
            {"user_id": "user-1", "tmdb_id": 101, "criteria_overrides": {}},
            {"user_id": "user-1", "tmdb_id": 202, "criteria_overrides": {}},
        ]
        batches = dispatcher._new_batches(pending, set(), NOW)
        self.assertEqual(len(batches), 1)
        self.assertEqual({item.tmdb_id for item in batches[0].items}, {101, 202})


if __name__ == "__main__":
    unittest.main()
