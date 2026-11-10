"""Parse Rotten Tomatoes scorecard fields while preserving explicit zero values."""

import re
import unicodedata
from urllib.parse import urljoin, urlsplit

from html.parser import HTMLParser


def _first_truthy_or_numeric_zero(*values):
    for value in values:
        if value or (isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0):
            return value
    return ""


def _digits_as_int_or_none(value):
    digits = re.sub(r"[^\d]", "", str(value))
    return int(digits) if digits else None


def parse_rotten_tomatoes_scorecard(scorecard):
    """Extract RT ratings and counts, distinguishing numeric zero from missing data."""
    scorecard = scorecard if isinstance(scorecard, dict) else {}
    overlay = scorecard.get("overlay") or {}
    critics = scorecard.get("criticsScore") or overlay.get("criticsAll") or {}
    audience = scorecard.get("audienceScore") or overlay.get("audienceVerified") or overlay.get("audienceAll") or {}

    return {
        "rtCriticRating": _digits_as_int_or_none(_first_truthy_or_numeric_zero(critics.get("score"), critics.get("scorePercent"))),
        "rtCriticVotes": _digits_as_int_or_none(_first_truthy_or_numeric_zero(critics.get("ratingCount"), critics.get("reviewCount"))),
        "rtAudienceRating": _digits_as_int_or_none(_first_truthy_or_numeric_zero(audience.get("score"), audience.get("scorePercent"))),
        "rtAudienceVotes": _digits_as_int_or_none(_first_truthy_or_numeric_zero(audience.get("bandedRatingCount"), audience.get("ratingCount"), audience.get("reviewCount"))),
    }


def _normalized_title(value):
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.findall(r"[^\W_]+", normalized, flags=re.UNICODE))


class _RottenTomatoesSearchParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.title = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "search-page-media-row":
            self.row = {"year": attrs.get("release-year") or attrs.get("releaseyear")}
        elif self.row is not None and tag == "a" and attrs.get("slot") == "title":
            self.title = []
            self.row["href"] = attrs.get("href", "")

    def handle_data(self, data):
        if self.title is not None:
            self.title.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.title is not None:
            self.row["title"] = " ".join(self.title)
            self.title = None
        elif tag == "search-page-media-row" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
            self.title = None


def select_rotten_tomatoes_search_match(html, title, release_year):
    """Accept only title-matched movies within two years, preferring closer years."""
    normalized = _normalized_title(title)
    try:
        year = int(release_year)
    except (TypeError, ValueError):
        return None
    if not normalized or not year:
        return None
    parser = _RottenTomatoesSearchParser()
    parser.feed(html or "")
    matches = []
    for index, row in enumerate(parser.rows[:10]):
        if _normalized_title(row.get("title")) != normalized:
            continue
        try:
            distance = abs(int(row.get("year")) - year)
        except (TypeError, ValueError):
            continue
        url = urljoin("https://www.rottentomatoes.com", row.get("href", ""))
        parsed = urlsplit(url)
        if distance <= 2 and parsed.scheme == "https" and parsed.netloc == "www.rottentomatoes.com" and parsed.path.startswith("/m/"):
            matches.append((distance, index, url))
    return min(matches)[2] if matches else None
