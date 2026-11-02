"""Compare complete live scraper output without publishing it.

Run with ``python -m backend.scraping.compare SCRAPER --output DIR``.
The output directory contains both snapshots and an exact multiset comparison.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import traceback

from backend.config.registry import REGISTRY
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema, build_chrome, navigate


def rows_from_columns(columns):
    if not isinstance(columns, dict) or any(not isinstance(v, list) for v in columns.values()):
        raise ValueError("Collector did not produce column lists")
    lengths = {len(v) for v in columns.values()}
    if len(lengths) > 1:
        raise ValueError("Collector output columns have unequal lengths")
    keys = [k for k in columns if k not in {"run_id", "snapshot_id"}]
    count = next(iter(lengths), 0)
    return [{k: columns[k][i] for k in keys} for i in range(count)]


def compare_rows(left, right):
    def bag(rows):
        return Counter(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")) for row in rows)
    a, b = bag(left), bag(right)
    return {
        "matched": sum((a & b).values()),
        "selenium_only": [{"row": json.loads(row), "count": count} for row, count in (a - b).items()],
        "requests_only": [{"row": json.loads(row), "count": count} for row, count in (b - a).items()],
    }


def collect(cls, mode):
    started = time.perf_counter()
    scraper = cls.__new__(cls)
    InitializeBaseCinema.__init__(scraper)
    scraper.run_id = 0
    scraper.driver = None
    scraper._empty_snapshot_evidence = None
    scraper._http_stats = {'requests': 0, 'observed_retries': 0}
    scraper._coverage = {}
    result = {"transport": mode, "started_at": datetime.now(timezone.utc).isoformat()}
    try:
        if mode == "selenium":
            scraper.driver = build_chrome(scraper.HEADLESS)
            navigate(scraper)
            scraper.selenium_logic()
        else:
            scraper.requests_logic()
        rows = rows_from_columns(scraper.gathering_info)
        if not rows and not scraper._empty_snapshot_evidence:
            raise ValueError("Empty collection without source evidence")
        result.update(status="ok", rows=rows, empty_evidence=scraper._empty_snapshot_evidence)
    except Exception as error:
        result.update(status="error", error=f"{type(error).__name__}: {error}", traceback=traceback.format_exc())
        try:
            result['partial_rows'] = rows_from_columns(scraper.gathering_info)
        except Exception:
            pass
    finally:
        if scraper.driver is not None:
            try:
                scraper.driver.quit()
            except Exception as error:
                result.update(status="error", error=f"Browser cleanup failed: {error}")
        result["seconds"] = time.perf_counter() - started
        result["http_stats"] = scraper._http_stats
        result["coverage"] = scraper._coverage
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scraper")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--first", choices=("selenium", "requests"), default="selenium")
    args = parser.parse_args()
    classes = {cls.__name__: cls for group in REGISTRY.values() for cls in group}
    if args.scraper not in classes:
        parser.error(f"Unknown scraper {args.scraper!r}")
    order = [args.first, "requests" if args.first == "selenium" else "selenium"]
    snapshots = {mode: collect(classes[args.scraper], mode) for mode in order}
    comparison = None
    if all(snapshots[mode]["status"] == "ok" for mode in order):
        comparison = compare_rows(snapshots["selenium"]["rows"], snapshots["requests"]["rows"])
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / f"{args.scraper}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    path.write_text(json.dumps({"scraper": args.scraper, "order": order, "snapshots": snapshots, "comparison": comparison}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(path)
    return 0 if comparison is not None and not comparison["selenium_only"] and not comparison["requests_only"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
