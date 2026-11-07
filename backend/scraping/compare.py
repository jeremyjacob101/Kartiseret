"""Compare complete live scraper output without publishing it.

Run with ``python -m backend.scraping.compare SCRAPER --output DIR``.
The output directory contains both snapshots and an exact multiset comparison.
Add ``--capture-source-responses`` to save compressed raw HTTP responses for diagnosis.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
import traceback
from concurrent.futures import ProcessPoolExecutor

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


def collect(cls, mode, source_capture_dir=None):
    started = time.perf_counter()
    scraper = cls.__new__(cls)
    InitializeBaseCinema.__init__(scraper)
    scraper.run_id = 0
    scraper.supabase_table_name = next(key for key, classes in REGISTRY.items() if cls in classes)
    scraper.driver = None
    scraper._empty_snapshot_evidence = None
    scraper._http_stats = {'requests': 0, 'observed_retries': 0}
    scraper._coverage = {}
    result = {"transport": mode, "started_at": datetime.now(timezone.utc).isoformat()}
    previous_capture_dir = os.environ.get("SCRAPER_SOURCE_CAPTURE_DIR")
    try:
        if mode == "selenium":
            scraper.driver = build_chrome(scraper.HEADLESS)
            navigate(scraper)
            scraper.selenium_logic()
        else:
            if source_capture_dir is not None:
                os.environ["SCRAPER_SOURCE_CAPTURE_DIR"] = str(source_capture_dir)
            scraper.requests_logic()
            scraper._validate_requests_collection()
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
        if source_capture_dir is not None:
            result["source_capture"] = str(source_capture_dir)
        if previous_capture_dir is None:
            os.environ.pop("SCRAPER_SOURCE_CAPTURE_DIR", None)
        else:
            os.environ["SCRAPER_SOURCE_CAPTURE_DIR"] = previous_capture_dir
    return result


def run_comparison(scraper_name, output, first='selenium', capture=False, transport=None):
    classes = {cls.__name__: cls for group in REGISTRY.values() for cls in group}
    order = [transport] if transport else [first, 'requests' if first == 'selenium' else 'selenium']
    output.mkdir(parents=True, exist_ok=True)
    snapshots = {}
    for mode in order:
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        capture_dir = output / 'sources' / scraper_name / f'{stamp}-{mode}' if capture else None
        snapshots[mode] = collect(classes[scraper_name], mode, capture_dir)
    comparison = None
    if not transport and all(snapshots[mode]['status'] == 'ok' for mode in order):
        comparison = compare_rows(snapshots['selenium']['rows'], snapshots['requests']['rows'])
    path = output / f"{scraper_name}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    path.write_text(json.dumps({'scraper': scraper_name, 'order': order, 'snapshots': snapshots, 'comparison': comparison}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(path, flush=True)
    if transport:
        return 0 if snapshots[transport]['status'] == 'ok' else 1
    return 0 if comparison is not None and not comparison['selenium_only'] and not comparison['requests_only'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scrapers', nargs='+', help='Registered scraper names, or "all"')
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--first", choices=("selenium", "requests"), default="selenium")
    parser.add_argument("--capture-source-responses", action="store_true")
    parser.add_argument('--transport', choices=('requests', 'selenium'), help='Collect one transport without a parity claim')
    parser.add_argument('--workers', type=int, default=1, help='Isolated processes when scraper is "all" (1–3)')
    args = parser.parse_args()
    classes = {cls.__name__: cls for group in REGISTRY.values() for cls in group}
    for name in args.scrapers:
        if name != 'all' and name not in classes:
            parser.error(f'Unknown scraper {name!r}')
    if 'all' in args.scrapers and len(args.scrapers) != 1:
        parser.error('Use "all" by itself')
    if not 1 <= args.workers <= 3:
        parser.error('--workers must be between 1 and 3')
    names = list(classes) if args.scrapers == ['all'] else list(dict.fromkeys(args.scrapers))
    # Source-capture configuration is process-local; threads would mix sources.
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(run_comparison, name, args.output, args.first, args.capture_source_responses, args.transport) for name in names]
        return max(future.result() for future in futures)


if __name__ == "__main__":
    raise SystemExit(main())
