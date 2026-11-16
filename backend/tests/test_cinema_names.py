import unittest

from backend.cinema_names import canonical_cinema_name, canonical_scrape_source


class CinemaNameCompatibilityTests(unittest.TestCase):
    def test_canonicalizes_legacy_chain_and_venue_names(self):
        self.assertEqual(canonical_cinema_name("Yes Planet"), "Planet Cinema")
        self.assertEqual(
            canonical_cinema_name(" Yes Planet Jerusalem "),
            "Planet Cinema Jerusalem",
        )

    def test_leaves_other_names_untouched(self):
        self.assertEqual(canonical_cinema_name("Cinema City Jerusalem"), "Cinema City Jerusalem")

    def test_maps_legacy_scraper_class_names(self):
        self.assertEqual(canonical_scrape_source("YesPlanet"), "PlanetCinema")
        self.assertEqual(canonical_scrape_source("YPsoon"), "PCsoon")
        self.assertEqual(canonical_scrape_source("PlanetCinema"), "PlanetCinema")


if __name__ == "__main__":
    unittest.main()
