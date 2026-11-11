"""Versioned matching summaries: decisions and counts, never per-showtime audits."""
from collections import Counter
from copy import deepcopy
import json
import re
import unicodedata

VERSION = 2
SIGNALS = ("title", "year", "director", "runtime")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _normalize_title(value):
    if not isinstance(value, str):
        return ""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[-–—:?!&]+", " ", value)
    value = re.sub(r"[^a-z0-9 ]+", "", value)
    return re.sub(r"\s+", " ", value).strip()


def compact_sources(rows):
    profiles = {}
    for source in rows:
        title = source.get("title") or source.get("normalized_title") or ""
        normalized_title = source.get("normalized_title") or _normalize_title(title)
        director = source.get("director") or ""
        key = canonical({
            "normalized_title": normalized_title,
            "release_year": source.get("release_year"),
            "normalized_director": _normalize_title(director),
            "runtime": source.get("runtime"),
        })
        if key not in profiles:
            profiles[key] = {
                "title": title,
                "normalized_title": normalized_title,
                "release_year": source.get("release_year"),
                "director": director,
                "runtime": source.get("runtime"),
                "source_providers": [],
                "source_cinemas": [],
                "row_count": 0,
                "comparison_weight": 0,
            }
        profile = profiles[key]
        represented_rows = int(source.get("row_count", 1))
        profile["row_count"] += represented_rows
        profile["comparison_weight"] += int(source.get("comparison_weight", represented_rows))
        providers = source.get("source_providers") or source.get("providers")
        if not isinstance(providers, list):
            providers = [source.get("source") or source.get("cinema") or "unknown"]
        cinemas = source.get("source_cinemas") or source.get("cinemas")
        if not isinstance(cinemas, list):
            cinemas = [source.get("cinema")] if source.get("cinema") else []
        profile["source_providers"] = sorted(set(profile["source_providers"]).union(str(v) for v in providers if v))
        profile["source_cinemas"] = sorted(set(profile["source_cinemas"]).union(str(v) for v in cinemas if v))
    return list(profiles.values())


def compact_group(group):
    if group.get("evidence_format_version") == VERSION:
        return deepcopy(group)
    result = {k: deepcopy(v) for k, v in group.items()
              if k not in {"source_rows", "candidates", "search_requests", "detail_request_failures"}}
    result.pop("alternatives", None)
    result.pop("dataflow", None)
    result["decisions"] = []
    for event in group.get("decisions", []):
        decision = {k: v for k, v in event.items() if k != "at" and v is not None and v != ""}
        if not result["decisions"] or decision != result["decisions"][-1]:
            result["decisions"].append(decision)
    result["evidence_format_version"] = VERSION
    result["source_rows"] = compact_sources(group.get("source_rows", []))
    result["source_row_count"] = sum(s["row_count"] for s in result["source_rows"])
    result["distinct_matching_inputs"] = len(result["source_rows"])
    result["candidate_coverage"] = []
    result["candidate_detail_outcomes"] = Counter()
    result["candidate_detail_validations"] = Counter()
    result["missing_candidate_detail_fields"] = Counter()
    result["all_candidate_signal_counts"] = {signal: Counter() for signal in SIGNALS}
    result["selected_comparisons"] = {}
    result["candidates"] = []
    result["comparison_examples"] = {signal: {"total": 0, "examples": []} for signal in SIGNALS}
    chosen = str(group.get("chosen_tmdb_id"))
    candidates = group.get("candidates", [])
    kept = {id(c) for c in candidates if str(c.get("tmdb_id")) == chosen}
    kept.update(id(c) for c in [c for c in candidates if str(c.get("tmdb_id")) != chosen][:5])
    for candidate in candidates:
        comparisons = {}
        for signal, values in candidate.get("comparisons", {}).items():
            counts = Counter()
            for value in values:
                weight = int(value.get("weight", 1))
                count_value = {k: value[k] for k in ("signal", "difference_minutes") if k in value}
                counts[canonical(count_value)] += weight
                if value.get("signal") != "agree" and signal in result["comparison_examples"]:
                    examples = result["comparison_examples"][signal]
                    examples["total"] += weight
                    if value.get("signal") == "conflict" and len(examples["examples"]) < 3:
                        examples["examples"].append({"tmdb_id": candidate.get("tmdb_id"),
                            **{k: v for k, v in value.items() if k not in {"source_row_id", "weight"}}})
            comparisons[signal] = [{**json.loads(key), "weight": count} for key, count in sorted(counts.items())]
        validation = candidate.get("response_validation") or {}
        result["candidate_coverage"].append([candidate.get("tmdb_id"), candidate.get("original_release_date"),
                                              bool(validation.get("canonical_profile_valid"))])
        if candidate.get("detail_request"):
            result["candidate_detail_outcomes"][candidate["detail_request"].get("outcome") or "unknown"] += 1
        if validation:
            result["candidate_detail_validations"]["valid" if validation.get("canonical_profile_valid") else "incomplete"] += 1
            result["missing_candidate_detail_fields"].update(validation.get("missing_fields_or_sections") or [])
        for signal, values in comparisons.items():
            if signal in SIGNALS:
                for value in values:
                    result["all_candidate_signal_counts"][signal][value.get("signal", "missing")] += value["weight"]
        if str(candidate.get("tmdb_id")) == chosen:
            result["selected_comparisons"] = comparisons
        if id(candidate) in kept:
            detail = {k: deepcopy(candidate[k]) for k in
                      ("tmdb_id", "search_rank", "title", "original_title", "original_release_date",
                       "directors", "runtime", "details_available") if k in candidate}
            result["candidates"].append(detail)
    for examples in result["comparison_examples"].values():
        examples["shown"] = len(examples["examples"])
    requests = group.get("search_requests", [])
    result["search_summary"] = {
        "request_count": len(requests),
        "outcomes": dict(Counter(r.get("outcome", "unknown") for r in requests)),
        "result_count": sum(int(r.get("result_count") or 0) for r in requests),
        "failures": [{k: r.get(k) for k in ("query", "primary_release_year", "page", "outcome")}
                     for r in requests if r.get("outcome") not in {"success", "cached"}][:3],
    }
    failures = group.get("detail_request_failures", [])
    result["detail_failure_summary"] = {"count": len(failures),
        "outcomes": dict(Counter(f.get("outcome", "unknown") for f in failures)),
        "reasons": dict(Counter(f.get("reason", "unknown") for f in failures)), "examples": failures[:3]}
    return result


def compact_document(document):
    return {**{k: v for k, v in document.items() if k != "groups"},
            "evidence_format_version": VERSION,
            "groups": [compact_group(group) for group in document["groups"]]}


def document_totals(document):
    groups = document["groups"]
    return {"group_count": len(groups),
            "source_row_count": sum(g.get("source_row_count", 0) for g in groups),
            "statuses": dict(Counter(g.get("status", "unknown") for g in groups)),
            "selection_reasons": dict(Counter(g.get("selection_reason", "unknown") for g in groups))}


def compact_dataflow_summary(summary):
    """Preserve every group, collapse repeated action text and avoid body/metadata duplication."""
    result = deepcopy(summary)
    if result.get("summary_format_version") == VERSION:
        return result
    for key in ("write_or_dedupe_actions", "unresolved_or_dropped", "notes"):
        values = result.get(key, [])
        counts = Counter(canonical(value) for value in values)
        result[key] = [({"value": json.loads(value), "count": count}) for value, count in sorted(counts.items())]
    for key in ("coming_soon_details", "cinematheque_groups", "now_playing_groups"):
        if key in result:
            result[key] = [json.loads(value) | {"event_count": count}
                           for value, count in sorted(Counter(canonical(v) for v in result[key]).items())]
    result["summary_format_version"] = VERSION
    return result
