from unittest import TestCase

from backend.utils.log.tmdb_matching_report import build_tmdb_matching_report, read_tmdb_evidence


def evidence(run_id, title, year, chosen, *, fingerprint="same-input", signal="agree"):
    tmdb_date = "2016-01-01" if chosen == 11 else "2024-01-01"
    return {
        "evidence_format_version": 1,
        "run_id": run_id,
        "attempt": 1,
        "category": "nowplayings",
        "identity_key": f"{title}:{year}",
        "input_fingerprint": fingerprint,
        "status": "mapped" if chosen else "unresolved",
        "selection_reason": "title_first_match" if chosen == 11 else "director_match" if chosen else "no_candidates",
        "chosen_tmdb_id": chosen,
        "source_rows": [{
            "normalized_title": title.lower(), "title": title,
            "release_year": year, "source": "Cinema A", "row_id": f"row-{run_id}",
        }],
        "candidates": [{
            "tmdb_id": chosen or 11,
            "original_release_date": tmdb_date,
            "detail_request": {"outcome": "success"},
            "comparisons": {
                "title": [{"signal": signal}],
                "year": [{"signal": "agree" if year == 2016 else "conflict"}],
                "director": [{"signal": "missing"}],
                "runtime": [{"signal": "conflict", "difference_minutes": 4}],
            },
        }],
    }


class FakeD1:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append((sql, tuple(params)))
        limit, offset = params[-2:]
        return type("Result", (), {"rows": self.rows[offset:offset + limit]})()


class MatchingReportTests(TestCase):
    def test_report_deduplicates_runs_and_reports_title_collision_conflicts_and_reuse_indicators(self):
        groups = [
            evidence(100, "Arrival", 2016, 11),
            evidence(101, "Arrival", 2016, 11),
            evidence(102, "Arrival", 2024, 12, fingerprint="different-year-input", signal="conflict"),
            evidence(103, "Common Film", 2020, None, fingerprint="unresolved-input"),
        ]
        # A duplicate run/identity/fingerprint should count once.
        groups.append({**groups[0], "attempt": 2, "finished_at": "later"})
        report = build_tmdb_matching_report(groups, current_year=2026)
        self.assertEqual(report["evaluation_count"], 4)
        self.assertEqual(report["distinct_mapped_films"], 2)
        self.assertEqual(report["repeated_input_reuse_indicators"]["same_choice_keys"], 1)
        arrival = next(row for row in report["source_title_groups"] if row["normalized_title"] == "arrival")
        self.assertEqual(arrival["years"], [2016, 2024])
        self.assertEqual(arrival["distinct_tmdb_choices"], 2)
        self.assertEqual(report["selected_signal_counts"]["year"]["conflict"], 1)
        self.assertEqual(report["selected_signal_counts"]["director"]["missing"], 3)
        self.assertEqual(report["selected_runtime_difference_minutes"]["1-5"], 3)
        self.assertLessEqual(report["archive_cutoff_year"], 2023)

    def test_read_only_loader_reassembles_chunked_evidence_without_tmdb_client(self):
        document = {
            "evidence_format_version": 1,
            "groups": [evidence(7, "Title", 2010, 11)],
        }
        encoded = __import__("json").dumps(document)
        rows = [
            {"artifact_id": "evidence-id", "chunk_index": index, "chunk_count": 2,
             "run_id": 7, "artifact_name": "flow-evidence", "text_content": part}
            for index, part in enumerate((encoded[:len(encoded) // 2], encoded[len(encoded) // 2:]))
        ]
        d1 = FakeD1(rows)
        result = read_tmdb_evidence(d1, run_id=7, limit=10)
        self.assertEqual(result[0]["chosen_tmdb_id"], 11)
        self.assertTrue(all("diagnostic_type = ?" in sql for sql, _ in d1.statements))
        self.assertTrue(all("UPDATE" not in sql.upper() and "DELETE" not in sql.upper() for sql, _ in d1.statements))

    def test_loader_rejects_incomplete_chunked_evidence(self):
        d1 = FakeD1([{
            "artifact_id": "broken", "chunk_index": 0, "chunk_count": 2,
            "run_id": 7, "artifact_name": "flow-evidence", "text_content": "{}",
        }])
        with self.assertRaisesRegex(ValueError, "incomplete"):
            read_tmdb_evidence(d1, run_id=7, limit=10)


if __name__ == "__main__":
    import unittest
    unittest.main()
