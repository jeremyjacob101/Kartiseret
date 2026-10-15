"""Parse Rotten Tomatoes scorecard fields while preserving explicit zero values."""

import re


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
