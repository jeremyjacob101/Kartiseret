import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from backend.notifications.ticket_alerts import (
    TicketAlertConfig,
    TicketAlertDispatcher,
    matches_ticket_alert_criteria,
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
    def test_defaults_match_all_cities_and_filters_and_allow_early_showings(self):
        row = showtime(
            screening_city="Haifa",
            date_of_showing="2026-10-22",
            showtime="10:00",
            screening_type="Regular",
        )
        self.assertTrue(matches_ticket_alert_criteria(row, DEFAULTS))
        self.assertEqual(
            select_linked_showtime([row], NOW, DEFAULTS).city,
            "Haifa",
        )

    def test_unrestricted_show_type_includes_unknown_one_off_labels(self):
        row = showtime(screening_type="One-off Screening")
        self.assertTrue(matches_ticket_alert_criteria(row, DEFAULTS))
        filtered = {
            **DEFAULTS,
            "filters": {**DEFAULTS["filters"], "showType": ["Regular"]},
        }
        self.assertFalse(matches_ticket_alert_criteria(row, filtered))

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
