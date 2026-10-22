from pathlib import Path
from unittest import TestCase

from backend.notifications.letterboxd_public import (
    LetterboxdSourceError,
    fetch_letterboxd_source,
    parse_letterboxd_page,
)


FIXTURES = Path(__file__).parent / "fixtures" / "letterboxd"
BASE_URL = "https://letterboxd.com/fixture/watchlist/"


class FakeResponse:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if not self.responses:
            raise AssertionError("Unexpected Letterboxd page request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class LetterboxdPublicPageTests(TestCase):
    def test_watchlist_pagination_deduplicates_films(self):
        client = FakeHttp(
            [
                FakeResponse(200, (FIXTURES / "watchlist-page-1.html").read_text()),
                FakeResponse(200, (FIXTURES / "watchlist-page-2.html").read_text()),
            ]
        )
        films = fetch_letterboxd_source(BASE_URL, http_client=client)
        self.assertEqual(
            [(film.slug, film.title, film.release_year) for film in films],
            [
                ("future-film", "Future Film", 2028),
                ("last-film", "Last Film", 2026),
                ("shared-film", "Shared Film", 2027),
            ],
        )
        self.assertEqual(
            [call[0] for call in client.calls],
            [
                BASE_URL,
                "https://letterboxd.com/fixture/watchlist/page/2/",
            ],
        )
        self.assertTrue(
            all(call[1]["allow_redirects"] is False for call in client.calls)
        )
        self.assertTrue(
            all("User-Agent" in call[1]["headers"] for call in client.calls)
        )

    def test_valid_empty_list_is_distinct_from_parse_failure(self):
        page = parse_letterboxd_page(
            (FIXTURES / "list-empty.html").read_text(),
            "https://letterboxd.com/fixture/list/empty/",
        )
        self.assertEqual(page.films, ())
        self.assertIsNone(page.next_page_url)

    def test_duplicate_movies_inside_a_page_collapse_to_one_slug(self):
        page = parse_letterboxd_page(
            """<ul class='poster-list'>
            <li><div data-film-slug='repeat' data-film-name='Repeat' data-film-release-year='2027'></div></li>
            <li><div data-film-slug='repeat' data-film-name='Repeat' data-film-release-year='2027'></div></li>
            </ul>""",
            BASE_URL,
        )
        self.assertEqual(len(page.films), 1)

    def test_failed_pages_and_unexpected_markup_never_look_like_an_empty_source(self):
        for response in (
            FakeResponse(403),
            FakeResponse(503),
            FakeResponse(200, "<html><body>Please sign in</body></html>"),
        ):
            with self.subTest(status=response.status_code):
                with self.assertRaises(LetterboxdSourceError):
                    fetch_letterboxd_source(BASE_URL, http_client=FakeHttp([response]))

    def test_pagination_refuses_external_urls_without_treating_them_as_last_page(self):
        with self.assertRaises(LetterboxdSourceError):
            parse_letterboxd_page(
                """<ul class='poster-list'></ul>
                <a class='next' rel='next' href='https://example.test/steal'>Next</a>""",
                BASE_URL,
            )

    def test_source_url_must_be_canonical_letterboxd_https(self):
        for source_url in (
            "http://letterboxd.com/fixture/watchlist/",
            "https://letterboxd.com.evil.test/fixture/watchlist/",
            "https://letterboxd.com/fixture/watchlist/?page=2",
        ):
            with self.subTest(url=source_url):
                with self.assertRaises(LetterboxdSourceError):
                    fetch_letterboxd_source(source_url, http_client=FakeHttp([]))


if __name__ == "__main__":
    import unittest

    unittest.main()
