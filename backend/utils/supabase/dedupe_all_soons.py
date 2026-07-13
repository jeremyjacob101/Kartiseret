from collections import defaultdict
from datetime import datetime, timezone
import os
import re
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


READ_BATCH_SIZE = 500
DELETE_BATCH_SIZE = 200
SOON_COLUMNS = [
    "id",
    "added",
    "run_id",
    "created_at",
    "english_title",
    "hebrew_title",
    "release_date",
    "original_language",
    "release_year",
    "rating",
    "directed_by",
    "runtime",
]


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def has_value(value: Any) -> bool:
    return normalize_text(value) not in {"", "0", "0.0", "none", "null", "nan"}


def soon_key(row: dict) -> tuple:
    return (
        normalize_text(row.get("english_title")),
        normalize_text(row.get("hebrew_title")),
        str(row.get("release_date") or ""),
    )


def parse_created_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def keeper_key(row: dict) -> tuple:
    # Keep unprocessed rows first so a cleanup cannot hide pending dataflow work.
    try:
        run_id = int(row.get("run_id") or -1)
    except (TypeError, ValueError):
        run_id = -1

    rich_columns = [
        "english_title",
        "hebrew_title",
        "release_date",
        "original_language",
        "release_year",
        "rating",
        "directed_by",
        "runtime",
    ]
    return (
        1 if row.get("added") is False else 0,
        sum(1 for column in rich_columns if has_value(row.get(column))),
        run_id,
        parse_created_at(row.get("created_at")),
        str(row.get("id") or ""),
    )


def select_all_soons(sb) -> list[dict]:
    rows: list[dict] = []
    start = 0
    select_columns = ",".join(SOON_COLUMNS)

    while True:
        batch = sb.table("allSoons").select(select_columns).order("id").range(start, start + READ_BATCH_SIZE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < READ_BATCH_SIZE:
            return rows
        start += READ_BATCH_SIZE


def duplicate_ids(rows: list[dict]) -> list[Any]:
    rows_by_key: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        rows_by_key[soon_key(row)].append(row)

    ids_to_delete: list[Any] = []
    for matching_rows in rows_by_key.values():
        if len(matching_rows) < 2:
            continue

        keeper = max(matching_rows, key=keeper_key)
        ids_to_delete.extend(row["id"] for row in matching_rows if row.get("id") and row.get("id") != keeper.get("id"))
    return ids_to_delete


def dedupe_all_soons(dry_run: bool = True) -> None:
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    rows = select_all_soons(sb)
    ids_to_delete = duplicate_ids(rows)

    print(f"Found {len(ids_to_delete)} duplicate rows out of {len(rows)} allSoons rows.")
    if dry_run:
        print("Dry run only. Change dry_run to False below to delete them.")
        return

    for start in range(0, len(ids_to_delete), DELETE_BATCH_SIZE):
        sb.table("allSoons").delete().in_("id", ids_to_delete[start : start + DELETE_BATCH_SIZE]).execute()

    print(f"Deleted {len(ids_to_delete)} duplicate rows from allSoons.")


if __name__ == "__main__":
    dedupe_all_soons(dry_run=False)
