from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from backend.utils.supabase.backfill_movie_release_dates import (
    BackfillInputError,
    build_report,
    generate_apply_sql,
    normalize_english,
    normalize_hebrew,
)


class ReleaseDateBackfillTests(TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name) / "artifacts"
        self.snapshot = {
            "format_version": 1,
            "project_ref": "test-project",
            "catalog_revision": 42,
            "visible_movies": [
                {"tmdb_id": 101, "english_title": "Alpha"},
                {"tmdb_id": 102, "english_title": "Beta"},
                {"tmdb_id": 103, "english_title": "Gamma"},
            ],
            "movie_titles": [
                {"tmdb_id": 101, "title": "Alpha", "language": "en", "source": "finalMovies"},
                {"tmdb_id": 102, "title": "Beta", "language": "en", "source": "finalMovies"},
                {"tmdb_id": 103, "title": "Gamma", "language": "en", "source": "finalMovies"},
                {"tmdb_id": 102, "title": "אותו שם", "language": "he", "source": "finalShowtimes"},
                {"tmdb_id": 103, "title": "אותו שם", "language": "he", "source": "finalShowtimes"},
                {"tmdb_id": 999, "title": "Legacy Alpha", "language": "en", "source": "finalShowtimes"},
            ],
            "title_fixes": [],
            "release_dates": [],
            "final_soon_dates": [],
            "run_logs": [],
        }
        self.as_of = datetime(2026, 10, 26, tzinfo=timezone.utc)

    def add_run(self, run_id: int, local_time: str, rows: list[dict], *, source: str = "CCsoon", attempt: int = 1):
        run_directory = self.root / str(run_id)
        successful = run_directory / "successful"
        successful.mkdir(parents=True, exist_ok=True)
        csv_path = successful / f"{source}-{attempt}.csv"
        with csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["english_title", "hebrew_title", "release_date", "run_id"])
            writer.writeheader()
            for row in rows:
                writer.writerow({**row, "run_id": run_id})
        self.snapshot["run_logs"].append({"run_id": run_id, "date_created": local_time, "successful": False})
        return csv_path

    def add_summary(self, run_id: int, lines: list[str], *, result: str = "SUCCESS"):
        path = self.root / str(run_id) / "successful" / "ComingSoonsTmdb-1-summary.txt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "DATAFLOW SUMMARY\n"
            f"Run ID: {run_id}\nResult: {result}\nStarted (UTC): 2026-10-01T09:00:00+00:00\n"
            "COMING SOONS DETAILS\n"
            + "\n".join(lines)
            + "\n",
            encoding="utf-8",
        )

    def report(self, *, lookback_days: int = 60):
        return build_report(self.snapshot, self.root, as_of=self.as_of, lookback_days=lookback_days)

    def movie(self, report: dict, tmdb_id: int) -> dict:
        return next(row for row in report["movies"] if row["tmdb_id"] == tmdb_id)

    def test_normalizers_match_pipeline_english_and_keep_hebrew_identity(self):
        self.assertEqual(normalize_english("The Cat-in-the-Hat: Part 2!"), "the cat in the hat part 2")
        self.assertEqual(normalize_hebrew("אוֹתוֹ שֵׁם"), normalize_hebrew("אותו שם"))

    def test_uses_successful_summary_mapping_and_current_titles_after_failed_parent_run(self):
        self.add_run(10, "2026-10-01 12:00:00", [
            {"english_title": "Archive Alias", "hebrew_title": "", "release_date": "2030-12-05"},
            {"english_title": "Beta", "hebrew_title": "", "release_date": "2031-01-06"},
        ])
        self.add_summary(10, [
            "- [mapped] tmdb_choice | title=archive alias | key=row-key | reason=fallback_first_candidate | tmdb=101",
            "- [mapped] enrich | title=Archive Alias | key=row-key | reason=enriched | tmdb=101",
        ])

        report = self.report()

        self.assertEqual(self.movie(report, 101)["status"], "ready_to_insert")
        self.assertEqual(self.movie(report, 101)["proposed_date"], "2030-12-05")
        self.assertEqual(self.movie(report, 102)["proposed_date"], "2031-01-06")
        self.assertIs(
            self.movie(report, 101)["latest_observations"][0]["parent_run_successful"],
            False,
        )
        self.assertTrue(
            any(
                item["summary_reason"] == "enriched"
                for item in self.movie(report, 101)["latest_observations"][0]["summary_evidence"]
            )
        )
        self.assertEqual(
            self.movie(report, 102)["latest_observations"][0]["identity_evidence"][0]["source"],
            "finalMovies",
        )
        self.assertTrue(all(item["attempt"] == 1 for item in self.movie(report, 102)["latest_observations"]))
        self.assertEqual(report["input_summary"]["eligible_runs"], 1)
        self.assertEqual(report["input_summary"]["eligible_parent_failed_runs"], 1)

    def test_uses_latest_run_even_when_it_corrects_the_date_earlier_and_later_null_is_ignored(self):
        self.add_run(10, "2026-10-01 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"}])
        self.add_run(11, "2026-10-02 12:00:00", [
            {"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-10"},
            {"english_title": "Alpha", "hebrew_title": "", "release_date": ""},
        ])

        report = self.report()

        self.assertEqual(self.movie(report, 101)["proposed_date"], "2031-06-10")
        self.assertEqual(self.movie(report, 101)["latest_run_id"], 11)

    def test_uses_observation_time_when_run_ids_are_not_monotonic(self):
        self.add_run(11, "2026-10-01 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"}])
        self.add_run(10, "2026-10-02 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-10"}])

        report = self.report()

        self.assertEqual(self.movie(report, 101)["proposed_date"], "2031-06-10")
        self.assertEqual(self.movie(report, 101)["latest_run_id"], 10)

    def test_skips_same_run_cinema_conflicts(self):
        self.add_run(10, "2026-10-01 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"}], source="CCsoon")
        self.add_run(10, "2026-10-01 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-21"}], source="YPsoon")

        report = self.report()

        self.assertEqual(self.movie(report, 101)["status"], "conflicting_latest_dates")
        self.assertEqual(self.movie(report, 101)["conflicting_dates"], ["2031-06-20", "2031-06-21"])

    def test_rejects_ambiguous_aliases_and_unconfirmed_fallback_candidates(self):
        self.add_run(10, "2026-10-01 12:00:00", [
            {"english_title": "", "hebrew_title": "אותו שם", "release_date": "2031-06-20"},
            {"english_title": "Only a Search Guess", "hebrew_title": "", "release_date": "2031-06-22"},
        ])
        self.add_summary(10, [
            "- [mapped] tmdb_choice | title=only a search guess | key=guess | reason=fallback_first_candidate | tmdb=103",
        ])

        report = self.report()

        self.assertEqual(self.movie(report, 102)["status"], "ambiguous_identity")
        self.assertEqual(self.movie(report, 103)["status"], "ambiguous_identity")
        self.assertEqual(self.report_movie_status(report, 101), "no_matching_history")
        self.assertEqual(report["input_summary"]["ambiguous_observations"], 1)

    def report_movie_status(self, report: dict, tmdb_id: int) -> str:
        return self.movie(report, tmdb_id)["status"]

    def test_highest_successful_attempt_and_window_boundaries_are_deterministic(self):
        self.add_run(9, "2026-08-26 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-01"}])
        self.add_run(10, "2026-08-27 03:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"}], attempt=1)
        self.add_run(10, "2026-08-27 03:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-22"}], attempt=2)

        report = self.report()

        self.assertEqual(self.movie(report, 101)["proposed_date"], "2031-06-22")
        self.assertEqual(report["input_summary"]["dated_scrape_observations"], 1)
        self.assertEqual(report["input_summary"]["eligible_runs"], 1)

    def test_explicit_title_fixes_override_an_old_alias_and_preserve_stored_dates(self):
        self.snapshot["title_fixes"] = [
            {"tmdb_id": "102", "title_fix": "Alpha"},
            {"tmdb_id": "101", "title_fix": "999"},
        ]
        self.snapshot["release_dates"] = [{"tmdb_id": 103, "local_release_date": "2028-09-30"}]
        self.add_run(10, "2026-10-01 12:00:00", [
            {"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"},
            {"english_title": "Legacy Alpha", "hebrew_title": "", "release_date": "2031-06-21"},
            {"english_title": "Gamma", "hebrew_title": "", "release_date": "2031-06-22"},
        ])

        report = self.report()

        self.assertEqual(self.movie(report, 102)["proposed_date"], "2031-06-20")
        self.assertEqual(self.movie(report, 101)["proposed_date"], "2031-06-21")
        self.assertEqual(self.movie(report, 103)["status"], "already_has_date")
        self.assertEqual(self.movie(report, 103)["stored_date"], "2028-09-30")
        self.assertEqual(
            self.movie(report, 102)["latest_observations"][0]["identity_evidence"][0]["source"],
            "tableFixes",
        )

    def test_fix_matching_preserves_hebrew_and_exact_precedence(self):
        self.snapshot["title_fixes"] = [
            {"tmdb_id": "101", "title_fix": "movieretro הוק"},
            {"tmdb_id": "102", "title_fix": "movieretro אסירים"},
            {"tmdb_id": "102", "title_fix": "A: Film"},
            {"tmdb_id": "103", "title_fix": "A - Film"},
        ]
        self.add_run(10, "2026-10-01 12:00:00", [
            {"english_title": "MovieRetro- הוק", "hebrew_title": "", "release_date": "2031-06-20"},
            {"english_title": "A: Film", "hebrew_title": "", "release_date": "2031-06-21"},
        ])
        report = self.report()
        self.assertEqual(self.movie(report, 101)["proposed_date"], "2031-06-20")
        self.assertEqual(self.movie(report, 102)["proposed_date"], "2031-06-21")
        evidence = self.movie(report, 101)["latest_observations"][0]["identity_evidence"]
        self.assertEqual(evidence[0]["match_tier"], "normalized")

    def test_invalid_date_rows_are_reported_and_not_written(self):
        self.add_run(10, "2026-10-01 12:00:00", [
            {"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-02-30"},
            {"english_title": "Alpha", "hebrew_title": "", "release_date": "20310620"},
        ])

        report = self.report()

        self.assertEqual(self.movie(report, 101)["status"], "no_matching_history")
        self.assertEqual(report["input_summary"]["invalid_release_date_rows"], 2)

    def test_generated_sql_is_guarded_scoped_and_safe_to_regenerate_after_success(self):
        self.add_run(10, "2026-10-01 12:00:00", [{"english_title": "Alpha", "hebrew_title": "", "release_date": "2031-06-20"}])
        report = self.report()

        sql = generate_apply_sql(report)

        self.assertIn("Target Supabase project: test-project", sql)
        self.assertIn("expected_revision bigint := 42", sql)
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertIn("solo_update = false", sql)
        self.assertIn("ON CONFLICT (tmdb_id) DO NOTHING", sql)
        self.assertIn("DATE '2031-06-20'", sql)

        self.snapshot["release_dates"] = [{"tmdb_id": 101, "local_release_date": "2031-06-20"}]
        refreshed = self.report()
        self.assertNotIn("movie_release_date_backfill$", generate_apply_sql(refreshed))
        self.assertIn("No missing, unambiguous", generate_apply_sql(refreshed))

    def test_rejects_missing_snapshot_contract_or_timezone_naive_as_of(self):
        with self.assertRaises(BackfillInputError):
            build_report({}, self.root, as_of=self.as_of)
        with self.assertRaises(BackfillInputError):
            build_report(self.snapshot, self.root, as_of=datetime(2026, 10, 26))


if __name__ == "__main__":
    import unittest

    unittest.main()
