from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit
import re

import requests


MAX_SOURCE_PAGES = 100
MAX_SOURCE_FILMS = 20_000
LETTERBOXD_USER_AGENT = (
    "Kartiseret public list sync/1.0 (+https://seret.site; contact: support@seret.site)"
)


class LetterboxdSourceError(RuntimeError):
    """A public Letterboxd source could not be fetched or parsed safely."""


@dataclass(frozen=True)
class LetterboxdFilm:
    slug: str
    title: str
    release_year: int | None


@dataclass(frozen=True)
class LetterboxdPage:
    films: tuple[LetterboxdFilm, ...]
    next_page_url: str | None


_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{1,180}$")
_FILM_PATH_RE = re.compile(r"^/film/([A-Za-z0-9_-]{1,180})(?:/|$)")
_VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


def _class_set(attrs: dict[str, str | None]) -> set[str]:
    return set((attrs.get("class") or "").split())


def _year(value: str | None) -> int | None:
    if not value or not re.fullmatch(r"\d{4}", value.strip()):
        return None
    parsed = int(value)
    return parsed if 1870 <= parsed <= 2200 else None


def _slug(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if raw.startswith("/film/"):
        match = _FILM_PATH_RE.match(raw)
        raw = match.group(1) if match else ""
    if raw.startswith("film:"):
        raw = raw[5:]
    return raw if _SLUG_RE.fullmatch(raw) else None


class _LetterboxdMarkup(HTMLParser):
    def __init__(self, requested_url: str):
        super().__init__(convert_charrefs=True)
        self.requested_url = requested_url
        self.stack: list[tuple[str, bool]] = []
        self.poster_list_count = 0
        self.poster_list_seen = False
        self.movies: dict[str, LetterboxdFilm] = {}
        self.next_href: str | None = None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        classes = _class_set(attrs)
        rel = set((attrs.get("rel") or "").lower().split())

        is_poster_list = tag in {"ul", "ol", "div"} and "poster-list" in classes
        if is_poster_list:
            self.poster_list_seen = True
            self.poster_list_count += 1
        if tag not in _VOID_TAGS:
            self.stack.append((tag, is_poster_list))

        if "next" in rel or (tag == "a" and "next" in classes):
            href = attrs.get("href")
            if href:
                if _next_url(self.requested_url, href) is None:
                    raise LetterboxdSourceError(
                        "Letterboxd returned an unsafe or unexpected next page link."
                    )
                self.next_href = href

        if self.poster_list_count == 0:
            return

        film_slug = _slug(attrs.get("data-film-slug"))
        href = attrs.get("href") or ""
        if not film_slug:
            match = _FILM_PATH_RE.match(urlsplit(href).path)
            film_slug = match.group(1) if match else None
        if not film_slug:
            return

        title = (attrs.get("data-film-name") or attrs.get("title") or "").strip()
        year = _year(
            attrs.get("data-film-release-year")
            or attrs.get("data-release-year")
            or attrs.get("data-film-year")
        )
        existing = self.movies.get(film_slug)
        if existing is not None:
            title = title or existing.title
            year = year or existing.release_year
        if title:
            self.movies[film_slug] = LetterboxdFilm(film_slug, title[:200], year)

    def handle_endtag(self, tag: str) -> None:
        matching = next(
            (index for index in range(len(self.stack) - 1, -1, -1) if self.stack[index][0] == tag),
            None,
        )
        if matching is None:
            return
        closed = self.stack[matching:]
        del self.stack[matching:]
        self.poster_list_count -= sum(1 for _tag, is_list in closed if is_list)


def _next_url(requested_url: str, href: str | None) -> str | None:
    if not href:
        return None
    try:
        target = urljoin(requested_url, href)
        parsed = urlsplit(target)
        requested = urlsplit(requested_url)
        if (
            parsed.scheme != "https"
            or parsed.hostname != "letterboxd.com"
            or parsed.username
            or parsed.password
            or parsed.port
            or parsed.query
            or parsed.fragment
        ):
            return None
        requested_path = requested.path.rstrip("/")
        current_page = 1
        page_match = re.search(r"/page/(\d+)$", requested_path)
        if page_match:
            current_page = int(page_match.group(1))
            base = requested_path[: page_match.start()]
        else:
            base = requested_path
        path = parsed.path.rstrip("/")
        match = re.fullmatch(re.escape(base) + r"/page/(\d+)", path)
        if not match or int(match.group(1)) != current_page + 1:
            return None
        return f"https://letterboxd.com{path}/"
    except ValueError:
        return None


def parse_letterboxd_page(html: str, requested_url: str) -> LetterboxdPage:
    if not isinstance(html, str) or not html.strip():
        raise LetterboxdSourceError("Letterboxd returned an empty page.")
    parser = _LetterboxdMarkup(requested_url)
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:
        raise LetterboxdSourceError("Letterboxd page markup could not be parsed.") from error
    if not parser.poster_list_seen:
        raise LetterboxdSourceError("Letterboxd page did not contain a film list.")
    return LetterboxdPage(
        films=tuple(parser.movies[key] for key in sorted(parser.movies)),
        next_page_url=_next_url(requested_url, parser.next_href),
    )


def fetch_letterboxd_source(
    source_url: str,
    *,
    http_client: Any = requests,
    max_pages: int = MAX_SOURCE_PAGES,
    max_films: int = MAX_SOURCE_FILMS,
) -> tuple[LetterboxdFilm, ...]:
    parsed_source = urlsplit(source_url)
    if (
        parsed_source.scheme != "https"
        or parsed_source.hostname != "letterboxd.com"
        or not parsed_source.path.endswith("/")
    ):
        raise LetterboxdSourceError("The configured Letterboxd URL is invalid.")

    page_url: str | None = source_url
    visited: set[str] = set()
    films: dict[str, LetterboxdFilm] = {}
    for _page_number in range(max_pages):
        if page_url is None:
            break
        if page_url in visited:
            raise LetterboxdSourceError("Letterboxd pagination repeated a page.")
        visited.add(page_url)
        try:
            response = http_client.get(
                page_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "User-Agent": LETTERBOXD_USER_AGENT,
                },
                timeout=(5, 20),
                allow_redirects=False,
            )
        except Exception as error:
            raise LetterboxdSourceError("Letterboxd could not be reached.") from error
        status = int(getattr(response, "status_code", 0) or 0)
        if status != 200:
            raise LetterboxdSourceError(
                f"Letterboxd returned HTTP {status or 'unknown'} for this public source."
            )
        page = parse_letterboxd_page(getattr(response, "text", ""), page_url)
        for film in page.films:
            previous = films.get(film.slug)
            if previous is None:
                films[film.slug] = film
            else:
                films[film.slug] = LetterboxdFilm(
                    film.slug,
                    film.title or previous.title,
                    film.release_year or previous.release_year,
                )
            if len(films) > max_films:
                raise LetterboxdSourceError(
                    f"This Letterboxd source contains more than {max_films} films."
                )
        page_url = page.next_page_url
    else:
        if page_url is not None:
            raise LetterboxdSourceError(
                f"This Letterboxd source exceeds the {max_pages}-page limit."
            )
    return tuple(films[key] for key in sorted(films))
