"""Canonical cinema labels and compatibility names for stored scrape data."""

from __future__ import annotations


CANONICAL_PLANET_CINEMA = "Planet Cinema"
LEGACY_PLANET_CINEMA = "Yes Planet"

_SCRAPE_SOURCE_ALIASES = {
    "YesPlanet": "PlanetCinema",
    "YPsoon": "PCsoon",
}

LEGACY_SCRAPE_SOURCE_NAMES = {
    current: legacy for legacy, current in _SCRAPE_SOURCE_ALIASES.items()
}


def canonical_cinema_name(value: object) -> str:
    """Return the current display label while preserving a venue suffix."""
    name = str(value or "").strip()
    if name.casefold() == LEGACY_PLANET_CINEMA.casefold():
        return CANONICAL_PLANET_CINEMA
    legacy_prefix = LEGACY_PLANET_CINEMA + " "
    if name.casefold().startswith(legacy_prefix.casefold()):
        return CANONICAL_PLANET_CINEMA + name[len(LEGACY_PLANET_CINEMA):]
    return name


def canonical_scrape_source(value: object) -> str:
    """Map renamed scraper class names to their stable logical source names."""
    name = str(value or "").strip()
    return _SCRAPE_SOURCE_ALIASES.get(name, name)


def same_cinema_source(left: object, right: object) -> bool:
    return canonical_cinema_name(left).casefold() == canonical_cinema_name(right).casefold()
