"""Parse Rotten Tomatoes scorecard fields while preserving explicit zero values."""

import re
import unicodedata
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup


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


def select_rotten_tomatoes_search_match(html, title, release_year):
    """Accept only title-matched movies within two years, preferring closer years."""
    normalized = _normalized_title(title)
    try:
        year = int(release_year)
    except (TypeError, ValueError):
        return None
    if not normalized or not year:
        return None
    matches = []
    for index, row in enumerate(BeautifulSoup(html or "", "html.parser").select("search-page-media-row")[:10]):
        anchor = row.select_one('a[slot="title"]')
        if not anchor or _normalized_title(anchor.get_text(" ", strip=True)) != normalized:
            continue
        try:
            distance = abs(int(row.get("release-year") or row.get("releaseyear")) - year)
        except (TypeError, ValueError):
            continue
        url = urljoin("https://www.rottentomatoes.com", anchor.get("href", ""))
        parsed = urlsplit(url)
        if distance <= 2 and parsed.scheme == "https" and parsed.netloc == "www.rottentomatoes.com" and parsed.path.startswith("/m/"):
            matches.append((distance, index, url))
    return min(matches)[2] if matches else None
