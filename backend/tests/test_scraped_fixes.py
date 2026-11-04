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


if __name__ == "__main__":
    unittest.main()
