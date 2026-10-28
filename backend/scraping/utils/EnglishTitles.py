"""Validate cinema title fields before they reach ASCII title normalization."""
import re
import unicodedata


def english_title_or_empty(value, hebrew_title=""):
    """Keep Latin or numeric titles; reject titles containing Hebrew or Cyrillic."""
    value = (value or "").strip()
    if re.search(r"[\u0590-\u05ff\ufb1d-\ufb4f\u0400-\u052f\u2de0-\u2dff\ua640-\ua69f\u1c80-\u1c8f]", value):
        return ""
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    # A previously ASCII-stripped Hebrew title such as "תמונות 2" can
    # survive as just "2". Do not treat that remnant as source evidence.
    hebrew_ascii = unicodedata.normalize("NFKD", hebrew_title or "").encode("ascii", "ignore").decode("ascii").strip()
    if re.search(r"[\u0590-\u05ff\ufb1d-\ufb4f]", hebrew_title or "") and re.fullmatch(r"[0-9]+", ascii_text) and ascii_text == hebrew_ascii:
        return ""
    return value if re.search(r"[A-Za-z0-9]", ascii_text) else ""
