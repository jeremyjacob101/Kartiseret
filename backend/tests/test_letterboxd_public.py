from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from backend.notifications.letterboxd_public import (
    LetterboxdSourceError,
    fetch_letterboxd_source,
    parse_letterboxd_page,
)


FIXTURES = Path(__file__).parent / "fixtures" / "letterboxd"
BASE_URL = "https://letterboxd.com/fixture/watchlist/"


class FakeResponse:
    def __init__(self, status_code, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}


class FakeHttp:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.closed = False

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if not self.responses:
            raise AssertionError("Unexpected Letterboxd page request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        self.closed = True


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
            "https://boxd.it/Fixture123$",
        ):
            with self.subTest(url=source_url):
                with self.assertRaises(LetterboxdSourceError):
                    fetch_letterboxd_source(source_url, http_client=FakeHttp([]))

    def test_boxd_share_link_resolves_to_a_visible_shared_list(self):
        short_url = "https://boxd.it/Fixture123$syntheticShareToken/"
        shared_url = (
            "https://letterboxd.com/fixture/list/spiderman/share/"
            "syntheticShareToken/"
        )
        page_html = """<div class="poster-grid">
          <ul class="grid">
            <li class="griditem">
              <div class="react-component"
                data-item-slug="spider-man-beyond-the-spider-verse"
                data-item-name="Spider-Man: Beyond the Spider-Verse"
                data-item-full-display-name="Spider-Man: Beyond the Spider-Verse (2027)"
                data-item-link="/film/spider-man-beyond-the-spider-verse/"></div>
            </li>
          </ul>
        </div>"""
        client = FakeHttp(
            [
                FakeResponse(302, headers={"Location": shared_url}),
                FakeResponse(200, page_html),
            ]
        )

        films = fetch_letterboxd_source(short_url, http_client=client)

        self.assertEqual(
            [(film.slug, film.title, film.release_year) for film in films],
            [
                (
                    "spider-man-beyond-the-spider-verse",
                    "Spider-Man: Beyond the Spider-Verse",
                    2027,
                )
            ],
        )
        self.assertEqual([call[0] for call in client.calls], [short_url, shared_url])
        self.assertTrue(
            all(call[1]["allow_redirects"] is False for call in client.calls)
        )
        self.assertEqual(client.calls[1][1]["headers"]["Referer"], short_url)

    def test_bare_boxd_short_link_resolves_to_a_public_list(self):
        short_url = "https://boxd.it/Y9Hce"
        public_url = "https://letterboxd.com/fixture/list/spiderman/"
        page_html = """<div class="poster-grid"><div
          data-item-slug="spider-man-beyond-the-spider-verse"
          data-item-full-display-name="Spider-Man: Beyond the Spider-Verse (2027)"
          data-item-link="/film/spider-man-beyond-the-spider-verse/"></div></div>"""
        client = FakeHttp(
            [
                FakeResponse(302, headers={"Location": public_url}),
                FakeResponse(200, page_html),
            ]
        )

        films = fetch_letterboxd_source(short_url, http_client=client)

        self.assertEqual(
            [film.slug for film in films],
            ["spider-man-beyond-the-spider-verse"],
        )
        self.assertEqual(
            [call[0] for call in client.calls], [short_url, public_url]
        )
        self.assertEqual(client.calls[1][1]["headers"]["Referer"], short_url)

    def test_boxd_share_link_refuses_redirects_outside_letterboxd_lists(self):
        client = FakeHttp(
            [
                FakeResponse(
                    302,
                    headers={"Location": "https://example.test/collect"},
                )
            ]
        )

        with self.assertRaisesRegex(
            LetterboxdSourceError, "supported public or shared list"
        ):
            fetch_letterboxd_source(
                "https://boxd.it/Fixture123$syntheticShareToken/",
                http_client=client,
            )

        self.assertEqual(len(client.calls), 1)

    def test_canonical_share_url_is_a_supported_letterboxd_source(self):
        shared_url = (
            "https://letterboxd.com/fixture/list/spiderman/share/"
            "syntheticShareToken/"
        )
        page_html = """<div class="poster-grid"><div
          data-item-slug="spider-man-beyond-the-spider-verse"
          data-item-full-display-name="Spider-Man: Beyond the Spider-Verse (2027)"
          data-item-link="/film/spider-man-beyond-the-spider-verse/"></div></div>"""

        films = fetch_letterboxd_source(
            shared_url,
            http_client=FakeHttp([FakeResponse(200, page_html)]),
        )

        self.assertEqual(len(films), 1)
        self.assertEqual(films[0].release_year, 2027)

    def test_share_page_reports_browser_challenge_without_retrying_it(self):
        short_url = "https://boxd.it/Fixture123$syntheticShareToken/"
        shared_url = (
            "https://letterboxd.com/fixture/list/spiderman/share/"
            "syntheticShareToken/"
        )
        client = FakeHttp(
            [
                FakeResponse(302, headers={"Location": shared_url}),
                FakeResponse(403, "Just a moment... challenge-platform"),
            ]
        )

        with self.assertRaisesRegex(
            LetterboxdSourceError, "requires browser verification"
        ):
            fetch_letterboxd_source(short_url, http_client=client)
        self.assertEqual(
            [call[0] for call in client.calls],
            [short_url, shared_url],
        )
        self.assertEqual(client.calls[1][1]["headers"]["Referer"], short_url)

    def test_default_http_client_uses_and_closes_a_requests_session(self):
        client = FakeHttp(
            [
                FakeResponse(200, (FIXTURES / "watchlist-page-1.html").read_text()),
                FakeResponse(200, (FIXTURES / "watchlist-page-2.html").read_text()),
            ]
        )
        with patch(
            "backend.notifications.letterboxd_public.requests.Session",
            return_value=client,
        ) as create_session:
            films = fetch_letterboxd_source(BASE_URL)

        create_session.assert_called_once_with()
        self.assertTrue(client.closed)
        self.assertTrue(films)


if __name__ == "__main__":
    import unittest

    unittest.main()
