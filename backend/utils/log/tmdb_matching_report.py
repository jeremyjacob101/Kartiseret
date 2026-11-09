"""Read-only report for TMDb matching evidence stored in run diagnostics.

Run with ``python -m backend.utils.log.tmdb_matching_report --target development``.
The command reads Cloudflare D1 only and never imports or calls the TMDb client.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
import os
import sys

from dotenv import load_dotenv

from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.dataflow.utils.TmdbMovieDetailsCache import archive_cutoff_year
from backend.utils.log.cloudflare_storage import D1Client


EVIDENCE_TYPE = "tmdb_matching_evidence"
PAGE_SIZE = 100


def _parse_iso(value: str) -> str:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def read_tmdb_evidence(d1: D1Client, *, since_iso: str | None = None,
                       run_id: int | None = None, limit: int = 10000) -> list[dict]:
    """Read and validate complete evidence artifacts, including chunk boundaries."""
    maximum = min(max(1, int(limit)), 100000)
    rows: list[dict] = []
    offset = 0
    while len(rows) < maximum:
        conditions = ["diagnostic_type = ?"]
        params: list[object] = [EVIDENCE_TYPE]
        if run_id is not None:
            conditions.append("run_id = ?")
            params.append(int(run_id))
        elif since_iso:
            conditions.append("created_at >= ?")
            params.append(_parse_iso(since_iso))
        page_limit = min(PAGE_SIZE, maximum - len(rows))
        params.extend((page_limit, offset))
        result = d1.execute(
            "SELECT diagnostic_id AS artifact_id, chunk_index, chunk_count, run_id, "
            "diagnostic_name AS artifact_name, text_content, created_at "
            "FROM diagnostics WHERE " + " AND ".join(conditions) + " "
            "ORDER BY created_at, run_id, diagnostic_name, diagnostic_id, chunk_index "
            "LIMIT ? OFFSET ?",
            params,
        )
        rows.extend(result.rows)
        if len(result.rows) < page_limit:
            break
        offset += len(result.rows)
    else:
        # A bounded report must never silently analyze only the prefix.
        conditions = ["diagnostic_type = ?"]
        params = [EVIDENCE_TYPE]
        if run_id is not None:
            conditions.append("run_id = ?")
            params.append(int(run_id))
        elif since_iso:
            conditions.append("created_at >= ?")
            params.append(_parse_iso(since_iso))
        params.extend((1, maximum))
        extra = d1.execute(
            "SELECT diagnostic_id FROM diagnostics WHERE " + " AND ".join(conditions) + " LIMIT ? OFFSET ?",
            params,
        )
        if extra.rows:
            raise ValueError(f"More than {maximum} diagnostic chunks matched; increase --limit.")

    artifacts: dict[str, dict] = {}
    for row in rows:
        artifact_id = str(row.get("artifact_id") or "")
        item = artifacts.setdefault(artifact_id, {**row, "_chunks": []})
        item["_chunks"].append((int(row.get("chunk_index", 0)), str(row.get("text_content") or "")))

    documents = []
    for artifact_id, artifact in artifacts.items():
        chunks = sorted(artifact.pop("_chunks"))
        expected = int(artifact.get("chunk_count", 1))
        if [index for index, _ in chunks] != list(range(expected)):
            raise ValueError(f"Evidence artifact {artifact_id} is incomplete; refusing a partial report.")
        try:
            document = json.loads("".join(text for _, text in chunks))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Evidence artifact {artifact_id} is invalid JSON.") from error
        if not isinstance(document, dict) or document.get("evidence_format_version") != 1:
            raise ValueError(f"Evidence artifact {artifact_id} has an unsupported format.")
        groups = document.get("groups")
        if not isinstance(groups, list) or any(not isinstance(group, dict) for group in groups):
            raise ValueError(f"Evidence artifact {artifact_id} has an invalid group list.")
        documents.extend(groups)
    return documents


def _deduplicate_evaluations(groups: list[dict]) -> list[dict]:
    # A retry may persist another attempt for the same run and input. Keep the
    # latest completed evidence row; retain distinct source fingerprints.
    selected = {}
    for group in groups:
        key = (
            group.get("run_id"), group.get("category"),
            group.get("identity_key"), group.get("input_fingerprint"),
        )
        current = selected.get(key)
        if current is None or str(group.get("finished_at") or "") >= str(current.get("finished_at") or ""):
            selected[key] = group
    return list(selected.values())


def build_tmdb_matching_report(groups: list[dict], *, current_year: int | None = None) -> dict:
    evaluations = _deduplicate_evaluations(groups)
    categories = Counter(group.get("category") or "unknown" for group in evaluations)
    statuses = Counter(group.get("status") or "unknown" for group in evaluations)
    reasons = Counter(group.get("selection_reason") or "unknown" for group in evaluations)
    chosen = [group for group in evaluations if group.get("chosen_tmdb_id")]
    distinct_films = {int(group["chosen_tmdb_id"]) for group in chosen if str(group["chosen_tmdb_id"]).isdigit()}

    signal_counts = {signal: Counter() for signal in ("title", "year", "director", "runtime")}
    runtime_differences = Counter()
    source_titles: dict[str, dict] = {}
    repeated_inputs: dict[tuple, dict] = defaultdict(lambda: {"runs": set(), "choices": Counter(), "categories": set()})
    detail_outcomes = Counter()
    detail_validations = Counter()
    missing_detail_fields = Counter()
    candidates_seen: set[int] = set()
    archived_candidate_ids: set[int] = set()
    cutoff_year = archive_cutoff_year() if current_year is None else current_year - 3

    for group in evaluations:
        repeat_key = (group.get("category"), group.get("input_fingerprint"))
        repeat = repeated_inputs[repeat_key]
        if group.get("run_id") is not None:
            repeat["runs"].add(str(group.get("run_id")))
        repeat["categories"].add(group.get("category") or "unknown")
        if group.get("chosen_tmdb_id"):
            repeat["choices"][str(group.get("chosen_tmdb_id"))] += 1

        for source in group.get("source_rows") or []:
            normalized = str(source.get("normalized_title") or "").strip()
            if not normalized:
                continue
            entry = source_titles.setdefault(normalized, {
                "source_title": source.get("title") or normalized,
                "categories": set(), "years": set(), "sources": set(),
                "evaluations": 0, "chosen_tmdb_ids": set(),
            })
            entry["categories"].add(group.get("category") or "unknown")
            entry["sources"].add(source.get("source") or source.get("cinema") or "unknown")
            if source.get("release_year") is not None:
                entry["years"].add(int(source["release_year"]))
            entry["evaluations"] += 1
            if group.get("chosen_tmdb_id"):
                entry["chosen_tmdb_ids"].add(int(group["chosen_tmdb_id"]))

        selected_id = group.get("chosen_tmdb_id")
        for candidate in group.get("candidates") or []:
            tmdb_id = candidate.get("tmdb_id")
            if tmdb_id:
                candidates_seen.add(int(tmdb_id))
            if candidate.get("detail_request"):
                detail_outcomes[candidate["detail_request"].get("outcome") or "unknown"] += 1
            validation = candidate.get("response_validation") or {}
            if validation:
                detail_validations["valid" if validation.get("canonical_profile_valid") else "incomplete"] += 1
                missing_detail_fields.update(validation.get("missing_fields_or_sections") or [])
            release_date = str(candidate.get("original_release_date") or "")
            try:
                if int(release_date[:4]) <= cutoff_year and tmdb_id and validation.get("canonical_profile_valid"):
                    archived_candidate_ids.add(int(tmdb_id))
            except (TypeError, ValueError):
                pass
            if not selected_id or str(selected_id) != str(tmdb_id):
                continue
            for signal, rows in (candidate.get("comparisons") or {}).items():
                if signal not in signal_counts:
                    continue
                for comparison in rows or []:
                    signal_counts[signal][comparison.get("signal") or "missing"] += 1
                    delta = comparison.get("difference_minutes")
                    if signal == "runtime" and isinstance(delta, (int, float)):
                        bucket = "0" if delta == 0 else "1-5" if delta <= 5 else "6-15" if delta <= 15 else "16+"
                        runtime_differences[bucket] += 1

    repeat_reuse = {"repeated_input_keys": 0, "same_choice_keys": 0, "changed_choice_keys": 0, "multi_choice_keys": 0}
    for record in repeated_inputs.values():
        if len(record["runs"]) < 2:
            continue
        repeat_reuse["repeated_input_keys"] += 1
        choice_ids = {choice for choice, count in record["choices"].items() if count}
        if len(choice_ids) == 1 and sum(record["choices"].values()) == len(record["runs"]):
            repeat_reuse["same_choice_keys"] += 1
        elif len(choice_ids) == 1:
            repeat_reuse.setdefault("repeat_keys_with_unresolved_runs", 0)
            repeat_reuse["repeat_keys_with_unresolved_runs"] += 1
        elif len(choice_ids) > 1:
            repeat_reuse["changed_choice_keys"] += 1
            repeat_reuse["multi_choice_keys"] += 1

    title_groups = []
    for normalized, entry in source_titles.items():
        title_groups.append({
            "normalized_title": normalized,
            "source_title": entry["source_title"],
            "categories": sorted(entry["categories"]),
            "source_count": len(entry["sources"]),
            "years": sorted(entry["years"]),
            "distinct_tmdb_choices": len(entry["chosen_tmdb_ids"]),
            "evaluation_count": entry["evaluations"],
        })
    title_groups.sort(key=lambda item: (-item["evaluation_count"], item["normalized_title"]))

    return {
        "evidence_format_version": 1,
        "evaluation_count": len(evaluations),
        "distinct_mapped_films": len(distinct_films),
        "distinct_tmdb_ids": sorted(distinct_films),
        "category_evaluations": dict(sorted(categories.items())),
        "statuses": dict(sorted(statuses.items())),
        "selection_reasons": dict(sorted(reasons.items())),
        "selected_signal_counts": {name: dict(sorted(counter.items())) for name, counter in signal_counts.items()},
        "selected_runtime_difference_minutes": dict(sorted(runtime_differences.items())),
        "source_title_group_count": len(source_titles),
        "source_title_groups": title_groups,
        "repeated_input_reuse_indicators": repeat_reuse,
        "candidate_detail_outcomes": dict(sorted(detail_outcomes.items())),
        "candidate_detail_validations": dict(sorted(detail_validations.items())),
        "missing_candidate_detail_fields": dict(sorted(missing_detail_fields.items())),
        "distinct_candidate_tmdb_ids": len(candidates_seen),
        "candidate_detail_archive_eligible_ids": len(archived_candidate_ids),
        "candidate_detail_archive_eligible_coverage": (
            round(len(archived_candidate_ids) / len(candidates_seen), 4) if candidates_seen else 0.0
        ),
        "archive_cutoff_year": cutoff_year,
    }


def _print_report(report: dict) -> None:
    print(f"TMDb matching evidence: {report['evaluation_count']} distinct input evaluations")
    print(f"Mapped distinct films: {report['distinct_mapped_films']}")
    print(f"By category: {json.dumps(report['category_evaluations'], sort_keys=True)}")
    print(f"By result: {json.dumps(report['statuses'], sort_keys=True)}")
    print(f"Selection reasons: {json.dumps(report['selection_reasons'], sort_keys=True)}")
    print("Selected candidate signals (source-row comparisons):")
    for signal, counts in report["selected_signal_counts"].items():
        print(f"  {signal}: {json.dumps(counts, sort_keys=True)}")
    print(f"Runtime differences in minutes: {json.dumps(report['selected_runtime_difference_minutes'], sort_keys=True)}")
    print(f"Source-title groups: {report['source_title_group_count']}")
    print(f"Repeated identical-input indicators: {json.dumps(report['repeated_input_reuse_indicators'], sort_keys=True)}")
    print(
        "Archived detail candidates: "
        f"{report['candidate_detail_archive_eligible_ids']}/{report['distinct_candidate_tmdb_ids']} "
        f"(cutoff <= {report['archive_cutoff_year']})"
    )
    print("Largest source-title groups (years and selected TMDb IDs help expose title collisions):")
    for group in report["source_title_groups"][:20]:
        print("  " + json.dumps(group, ensure_ascii=False, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--run-id", type=int, help="Report one run regardless of its age.")
    parser.add_argument("--since", help="ISO timestamp; defaults to the last seven days.")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args(argv)
    load_dotenv()
    try:
        selected = resolve_target_environment(args.target, os.environ)
    except ValueError as error:
        print(f"Invalid {args.target} D1 configuration: {error}", file=sys.stderr)
        return 2
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)
    since = args.since or (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        groups = read_tmdb_evidence(
            D1Client.from_environment(),
            since_iso=None if args.run_id is not None else since,
            run_id=args.run_id,
            limit=args.limit,
        )
        report = build_tmdb_matching_report(groups)
    except Exception as error:
        print(f"TMDb evidence report failed ({type(error).__name__}): {error}", file=sys.stderr)
        return 1
    if args.json_output:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    else:
        _print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
