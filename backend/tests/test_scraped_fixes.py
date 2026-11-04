import unittest

from backend.scraping.utils.ScrapedFixes import ScrapedFixes


class ScrapedFixesTests(unittest.TestCase):
    def test_bat_yam_normalizes_to_the_catalog_city(self):
        scraper = ScrapedFixes()
        scraper.screening_city = "בת ים"

        scraper.fixCinemaName()

        self.assertEqual(scraper.screening_city, "Bat Yam")

    def test_hot_cinema_branch_names_normalize_to_catalog_cities(self):
        branch_cities = {
            "HOT CINEMA גרנד חיפה": "Haifa",
            "HOT CINEMA קריון קרית ביאליק": "Kiryat Bialik",
            "HOT CINEMA DREAM STAGE חולון": "Holon",
            "HOT CINEMA DREAM STAGE": "Holon",
        }

        for branch_name, city in branch_cities.items():
            with self.subTest(branch_name=branch_name):
                scraper = ScrapedFixes()
                scraper.screening_city = branch_name

                scraper.fixCinemaName()

                self.assertEqual(scraper.screening_city, city)

    def test_yes_planet_infinity_vision_labels_normalize_type_and_tech(self):
        formats = {
            "INFINITY VISION2D": "2D Infinity Vision",
            "INFINITY VISIONSCREENX2D": "2D ScreenX Infinity Vision",
            "4DXINFINITY VISION2D": "2D 4DX Infinity Vision",
        }

        for raw_format, screening_tech in formats.items():
            with self.subTest(raw_format=raw_format):
                scraper = ScrapedFixes()
                scraper.screening_type = raw_format
                scraper.screening_tech = raw_format
                scraper.english_title = "Avengers: Doomsday"
                scraper.hebrew_title = "הנוקמים: עלייתו של ד״ר דום"

                scraper.fixScreeningType()
                scraper.fixScreeningTech()

                self.assertEqual(scraper.screening_type, "Regular")
                self.assertEqual(scraper.screening_tech, screening_tech)
                self.assertEqual(scraper.english_title, "Avengers: Doomsday")
                self.assertEqual(scraper.hebrew_title, "הנוקמים: עלייתו של ד״ר דום")

    def test_infinity_vision_in_title_appends_to_existing_or_default_tech(self):
        cases = [
            ("Avengers: Doomsday - Infinity Vision", "", None, "2D Infinity Vision"),
            ("", "הנוקמים - Infinity Vision", "2D", "2D Infinity Vision"),
            ("Avengers: Doomsday Infinity Vision", "", "2D Atmos", "2D Atmos Infinity Vision"),
            ("Avengers: Doomsday Infinity Vision", "", "2D ScreenX Infinity Vision", "2D ScreenX Infinity Vision"),
            ("Avengers: Doomsday", "", "2D", "2D"),
        ]

        for english_title, hebrew_title, screening_tech, expected_tech in cases:
            with self.subTest(english_title=english_title, hebrew_title=hebrew_title, screening_tech=screening_tech):
                scraper = ScrapedFixes()
                scraper.english_title = english_title
                scraper.hebrew_title = hebrew_title
                scraper.screening_tech = screening_tech
                scraper.screening_type = "Regular"

                scraper.fixScreeningTech()

                self.assertEqual(scraper.screening_tech, expected_tech)
                self.assertEqual(scraper.screening_type, "Regular")
                self.assertEqual(scraper.english_title, english_title)
                self.assertEqual(scraper.hebrew_title, hebrew_title)


if __name__ == "__main__":
    unittest.main()
