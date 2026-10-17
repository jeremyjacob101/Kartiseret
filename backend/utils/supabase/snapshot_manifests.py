"""Keep complete scrape manifest counts aligned with later raw-row cleanup."""

from __future__ import annotations


SNAPSHOT_COUNT_BATCH_SIZE = 500


def reconcile_snapshot_row_counts(sb, table_name: str, snapshot_ids) -> None:
    """Recount only completed snapshots whose raw rows were removed later."""
    for snapshot_id in sorted({str(value) for value in snapshot_ids if value}):
        count = 0
        start = 0
        while True:
            rows = sb.table(table_name).select("id").eq("snapshot_id", snapshot_id).order("id").range(
                start, start + SNAPSHOT_COUNT_BATCH_SIZE - 1
            ).execute().data or []
            count += len(rows)
            if len(rows) < SNAPSHOT_COUNT_BATCH_SIZE:
                break
            start += SNAPSHOT_COUNT_BATCH_SIZE

        sb.table("pipeline_scrape_snapshots").update({"row_count": count}).eq(
            "snapshot_id", snapshot_id
        ).eq("table_name", table_name).eq("status", "complete").execute()
