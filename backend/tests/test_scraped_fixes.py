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


if __name__ == "__main__":
    unittest.main()
