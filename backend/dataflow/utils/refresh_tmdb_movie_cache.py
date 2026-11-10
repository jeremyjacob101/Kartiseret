"""Refresh one canonical TMDb movie response and repair its persistent cache.

Run with ``python -m backend.dataflow.utils.refresh_tmdb_movie_cache --target development --tmdb-id 123``.
This command changes only the backend cache row for the requested TMDb ID.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from dotenv import load_dotenv

from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
from backend.dataflow.utils.DataflowRequests import DataflowRequests
from backend.dataflow.utils.TmdbMovieDetailsCache import validate_movie_details


class _CacheRefreshClient(DataflowRequests, DataflowHelpers):
    REQUEST_WORKERS = 1
    REQUESTS_PER_SECOND = 10

    def __init__(self, api_key: str):
        self.TMDB_API_KEY = api_key
        self.notes = []
        self.initDataflowRequests()

    def trace_note(self, note: str) -> None:
        self.notes.append(str(note))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--tmdb-id", type=int, required=True)
    args = parser.parse_args(argv)
    if args.tmdb_id <= 0:
        parser.error("--tmdb-id must be a positive integer")

    load_dotenv()
    try:
        selected = resolve_target_environment(args.target, os.environ)
    except ValueError as error:
        print(f"Invalid {args.target} cache configuration: {error}", file=sys.stderr)
        return 2
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)

    api_key = os.environ.get("TMDB_API_KEY", "").strip()
    if not api_key:
        print("TMDB_API_KEY is required for an explicit cache refresh.", file=sys.stderr)
        return 2

    client = _CacheRefreshClient(api_key)
    try:
        payload = client.tmdbMovieDetails(args.tmdb_id, allow_missing=False, force_refresh=True)
        if validate_movie_details(payload, args.tmdb_id) is None:
            print("TMDb returned an incomplete canonical response; the cache was not refreshed.", file=sys.stderr)
            return 1
        if client._tmdb_metrics.get("tmdb_cache_write_failures", 0):
            print("TMDb returned a valid response, but the persistent cache write failed.", file=sys.stderr)
            return 1
        cached = client._tmdb_movie_cache_rows.get(args.tmdb_id) or {}
        print(json.dumps({
            "tmdb_id": args.tmdb_id,
            "original_release_date": cached.get("original_release_date"),
            "fetched_at": cached.get("fetched_at"),
            "response_profile": cached.get("response_profile"),
            "cache_format_version": cached.get("cache_format_version"),
            "saved": True,
        }, sort_keys=True))
        return 0
    except Exception as error:
        print(f"TMDb cache refresh failed ({type(error).__name__}).", file=sys.stderr)
        return 1
    finally:
        client.closeDataflowRequests()


if __name__ == "__main__":
    raise SystemExit(main())
