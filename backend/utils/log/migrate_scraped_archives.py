"""Copy and budget the retirement of legacy per-row scrape archives."""
from __future__ import annotations

import argparse
import json
import os

from backend.utils.log.cloudflare_storage import CloudflareStorageError, D1Client
from backend.utils.log.run_storage import RunArtifactStore, SCRAPE_SNAPSHOT_TYPE, _hash

DAILY_MIGRATION_WRITE_BUDGET = 60_000
MIGRATION_RESERVE_OVERHEAD = 10
DELETE_BATCH_SIZE = 500


class MigrationWriteBudget:
    """Account-wide daily reservation ledger anchored in the production D1 DB."""

    def __init__(self, d1):
        self.d1 = d1

    @classmethod
    def from_environment(cls, environ=None):
        from backend.config.target_environment import resolve_target_environment
        production = resolve_target_environment("production", environ or os.environ)
        return cls(D1Client(
            production["D1_DATABASE_ID"], production["R2_ACCOUNT_ID"], production["D1_API_TOKEN"],
        ))

    def initialize(self):
        self.d1.execute(
            "CREATE TABLE IF NOT EXISTS snapshot_migration_budget ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), day_utc TEXT NOT NULL, "
            "reserved_writes INTEGER NOT NULL DEFAULT 0)"
        )
        self.d1.execute(
            "INSERT OR IGNORE INTO snapshot_migration_budget (id, day_utc, reserved_writes) VALUES (1, '', 0)"
        )

    def available(self) -> int:
        rows = self.d1.execute(
            "SELECT CASE WHEN day_utc = strftime('%Y-%m-%d', 'now') "
            "THEN reserved_writes ELSE 0 END AS reserved_writes "
            "FROM snapshot_migration_budget WHERE id = 1"
        ).rows
        if len(rows) != 1:
            raise CloudflareStorageError("Account-wide snapshot migration budget is unavailable.")
        return max(0, DAILY_MIGRATION_WRITE_BUDGET - int(rows[0]["reserved_writes"]))

    def reserve(self, amount: int) -> int:
        if amount < 1 or amount > DAILY_MIGRATION_WRITE_BUDGET:
            raise ValueError("Snapshot migration reservation is outside the daily budget.")
        today = str(self.d1.execute("SELECT strftime('%Y-%m-%d', 'now') AS day_utc").rows[0]["day_utc"])
        result = self.d1.execute(
            "UPDATE snapshot_migration_budget SET "
            "reserved_writes = CASE WHEN day_utc = ? THEN reserved_writes + ? ELSE ? END, day_utc = ? "
            "WHERE id = 1 AND (day_utc <> ? OR reserved_writes + ? <= ?)",
            (today, amount, amount, today, today, amount, DAILY_MIGRATION_WRITE_BUDGET),
        )
        if result.changes != 1:
            raise CloudflareStorageError(
                f"Daily archive migration budget exhausted; {self.available()} reserved writes remain."
            )
        return self.available()


def _groups(store):
    rows = store.d1.execute(
        "SELECT run_id, scraper, attempt, outcome, COUNT(*) AS row_count "
        "FROM scraped_rows GROUP BY run_id, scraper, attempt, outcome "
        "ORDER BY run_id, scraper, attempt, outcome"
    ).rows
    return rows


def _group_rows(store, group):
    rows = []
    offset = 0
    size = 500
    while True:
        result = store.d1.execute(
            "SELECT * FROM scraped_rows WHERE run_id = ? AND scraper = ? AND attempt = ? AND outcome = ? "
            "ORDER BY row_order, row_key LIMIT ? OFFSET ?",
            (group["run_id"], group["scraper"], group["attempt"], group["outcome"], size, offset),
        )
        rows.extend(result.rows)
        if len(result.rows) < size:
            break
        offset += len(result.rows)
    if len(rows) != int(group["row_count"]):
        raise CloudflareStorageError("Legacy scrape snapshot changed while it was being read.")
    return rows


def _snapshot_id(group):
    return _hash(
        f"scraped-snapshot:{int(group['run_id'])}:{group['scraper']}:{int(group['attempt'])}:{group['outcome']}"
    )


def _verify_registered_snapshot(store, group, rows, *, allow_partial=False):
    catalog = store.d1.execute(
        "SELECT artifact_id, run_id, artifact_type, artifact_name, object_key, content_type, "
        "metadata_json, created_at FROM artifacts WHERE artifact_id = ? AND artifact_type = ?",
        (_snapshot_id(group), SCRAPE_SNAPSHOT_TYPE),
    ).rows
    if len(catalog) != 1:
        raise CloudflareStorageError("Legacy rows cannot be deleted until their R2 catalog reference is confirmed.")
    item = store.read_scraped_snapshot(catalog[0])
    old_keys = [row.get("row_key") for row in rows]
    new_keys = [row.get("row_key") for row in item["rows"]]
    if not allow_partial and old_keys != new_keys:
        raise CloudflareStorageError("R2 snapshot does not preserve every legacy row identity and order.")
    if allow_partial:
        remaining = set(old_keys)
        if not remaining.issubset(new_keys) or [key for key in new_keys if key in remaining] != old_keys:
            raise CloudflareStorageError("R2 snapshot does not preserve every legacy row identity and order.")
    return item["metadata"]


def run(target: str, *, phase: str, apply: bool) -> dict:
    from backend.utils.log.shared_cleanup import _load_target, maintenance_lease
    from backend.config.target_environment import resolve_target_environment
    # Capture the account-wide ledger credentials before _load_target strips
    # every other target's secrets from the active environment.
    production_environment = resolve_target_environment("production", os.environ)
    _load_target(target)
    store = RunArtifactStore()
    if not apply:
        groups = _groups(store)
        total_rows = sum(int(group["row_count"]) for group in groups)
        registered = store.d1.execute(
            "SELECT COUNT(*) AS snapshot_count FROM artifacts WHERE artifact_type = ?",
            (SCRAPE_SNAPSHOT_TYPE,),
        ).rows
        remaining = None
        try:
            remaining = MigrationWriteBudget.from_environment(production_environment).available()
        except Exception:
            # A dry-run remains read-only even when the quota currently blocks
            # Cloudflare queries or the budget table is not installed yet.
            pass
        return {
            "target": target, "phase": phase, "mode": "dry-run",
            "snapshots": len(groups), "legacy_rows": total_rows,
            "registered_snapshots": int(registered[0]["snapshot_count"]) if registered else 0,
            "remaining_migration_writes": remaining,
        }

    reports = {"snapshots_processed": 0, "rows_copied": 0, "rows_deleted": 0,
               "budget_reserved_writes": 0, "snapshot_bytes_verified": 0}
    with maintenance_lease() as owned:
        if owned is None:
            raise CloudflareStorageError("Target lease is already held; archive migration did not start.")
        store, _token = owned
        groups = _groups(store)
        budget = MigrationWriteBudget.from_environment(production_environment)
        budget.initialize()

        def reserve(amount):
            budget.reserve(amount)
            reports["budget_reserved_writes"] += amount

        for group in groups:
            source_rows = _group_rows(store, group)
            if phase == "copy":
                # One catalog row and its indexes, plus reservation/control
                # writes, are covered before the R2 upload is attempted.
                reserve(20)
                store.save_scraped_snapshot(
                    run_id=int(group["run_id"]), scraper=str(group["scraper"]),
                    attempt=int(group["attempt"]), outcome=str(group["outcome"]), rows=source_rows,
                )
                metadata = _verify_registered_snapshot(store, group, source_rows)
                reports["snapshot_bytes_verified"] += int(metadata["size_bytes"])
                reports["rows_copied"] += len(source_rows)
            else:
                metadata = _verify_registered_snapshot(store, group, source_rows, allow_partial=True)
                reports["snapshot_bytes_verified"] += int(metadata["size_bytes"])
                while True:
                    current = store.d1.execute(
                        "SELECT row_key FROM scraped_rows WHERE run_id = ? AND scraper = ? AND attempt = ? AND outcome = ? "
                        "ORDER BY row_order, row_key LIMIT ?",
                        (group["run_id"], group["scraper"], group["attempt"], group["outcome"], DELETE_BATCH_SIZE),
                    ).rows
                    if not current:
                        break
                    reserve(3 * len(current) + MIGRATION_RESERVE_OVERHEAD)
                    result = store.d1.execute(
                        "DELETE FROM scraped_rows WHERE row_key IN (SELECT row_key FROM scraped_rows "
                        "WHERE run_id = ? AND scraper = ? AND attempt = ? AND outcome = ? "
                        "ORDER BY row_order, row_key LIMIT ?)",
                        (group["run_id"], group["scraper"], group["attempt"], group["outcome"], DELETE_BATCH_SIZE),
                    )
                    if result.changes != len(current):
                        raise CloudflareStorageError("Legacy scrape deletion count was uncertain; reservation retained.")
                    reports["rows_deleted"] += result.changes
            reports["snapshots_processed"] += 1
        reports["remaining_migration_writes"] = budget.available()
    return {"target": target, "phase": phase, "mode": "apply", **reports}


def main(argv=None):
    from dotenv import load_dotenv
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--phase", choices=("copy", "delete"), required=True)
    parser.add_argument("--apply", action="store_true", help="Apply changes; default is read-only dry-run")
    args = parser.parse_args(argv)
    print(json.dumps(run(args.target, phase=args.phase, apply=args.apply), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
