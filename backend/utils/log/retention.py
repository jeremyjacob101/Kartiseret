"""Bounded run-artifact cleanup invoked by the scraper, with no background service."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re

from backend.utils.log.cloudflare_storage import CloudflareStorageError

HIGH_WATER_BYTES = 350_000_000
LOW_WATER_BYTES = 300_000_000
DAILY_WRITE_BUDGET = 5_000


def cleanup_by_storage(store, *, now=None, lease_token: str | None = None):
    from backend.utils.log.run_storage import _r2_client

    now = now or datetime.now(timezone.utc)
    d1 = store.d1
    size = d1.measure_database_size()
    rows = d1.execute('SELECT * FROM retention_state WHERE id = 1').rows
    if not rows:
        raise CloudflareStorageError('Retention state is missing.')
    state = rows[0]
    if state.get('halted'):
        raise CloudflareStorageError('Cleanup is halted; inspect the retention state before continuing.')
    if not state.get('active') and size < HIGH_WATER_BYTES:
        return {'size': size, 'pending': False}

    owns_lease = lease_token is None
    token = lease_token or store.acquire_run_lease(lease_hours=1)
    try:
        def renew_lease():
            store.renew_run_lease(token)

        size = d1.measure_database_size()
        day = now.date().isoformat()
        d1.execute("UPDATE retention_state SET active = 1, budget_day = ?, writes_reserved = CASE WHEN budget_day = ? THEN writes_reserved ELSE 0 END WHERE id = 1", (day, day))
        for _ in range(100):
            state = d1.execute('SELECT * FROM retention_state WHERE id = 1').rows[0]
            run_id = state.get('run_id')
            if size <= LOW_WATER_BYTES and run_id is None:
                d1.execute('UPDATE retention_state SET active = 0 WHERE id = 1')
                return {'size': size, 'pending': False}
            if run_id is None:
                cutoff = (now - timedelta(days=1)).isoformat()
                candidates = d1.execute(
                    "SELECT r.run_id FROM run_logs r WHERE r.status IN ('successful','failed') "
                    "AND r.started_at < ? AND r.created_at < ? "
                    "AND NOT EXISTS (SELECT 1 FROM scraped_rows s WHERE s.run_id = r.run_id) "
                    "AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.run_id = r.run_id AND a.artifact_type = 'scraped_snapshot') "
                    "ORDER BY r.started_at, r.run_id LIMIT 1", (cutoff, cutoff),
                ).rows
                if not candidates:
                    raise CloudflareStorageError('No safely removable completed run is available.')
                run_id = int(candidates[0]['run_id'])
                d1.execute('UPDATE retention_state SET run_id = ?, start_size = ? WHERE id = 1', (run_id, size))
                state['start_size'] = size
            remaining = DAILY_WRITE_BUDGET - int(state.get('writes_reserved') or 0)
            if remaining < 40:
                break
            count = min(80, (remaining - 20) // 4)
            d1.execute('UPDATE retention_state SET writes_reserved = writes_reserved + ? WHERE id = 1', (count * 4 + 20,))
            renew_lease()
            objects = d1.execute("SELECT artifact_id, object_key FROM artifacts WHERE run_id = ? AND object_key <> '' ORDER BY artifact_id LIMIT ?", (run_id, count)).rows
            if objects:
                for item in objects:
                    if not re.match(rf'^runs/\d{{4}}-\d{{2}}-\d{{2}}/{run_id}/', item['object_key']):
                        raise CloudflareStorageError('Invalid screenshot key in D1.')
                client = store.r2 or _r2_client()
                try:
                    response = client.delete_objects(Bucket=store.bucket, Delete={'Objects': [{'Key': item['object_key']} for item in objects], 'Quiet': True})
                except Exception as error:
                    from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                    if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
                        raise
                    raise CloudflareStorageError(f'R2 screenshot cleanup failed ({type(error).__name__}); metadata retained.') from error
                if response.get('Errors'):
                    raise CloudflareStorageError('R2 did not confirm all screenshot deletions.')
                renew_lease()
                placeholders = ','.join('?' for _ in objects)
                d1.execute(f'DELETE FROM artifacts WHERE run_id = ? AND artifact_id IN ({placeholders})', (run_id, *(item['artifact_id'] for item in objects)))
                size = d1.measure_database_size()
                continue
            deleted_any = False
            for table, key in (('scraped_rows', 'row_key'), ('gathering_rows', 'row_key'), ('diagnostics', 'rowid'), ('artifacts', 'artifact_id')):
                renew_lease()
                result = d1.execute(f'DELETE FROM {table} WHERE {key} IN (SELECT {key} FROM {table} WHERE run_id = ? LIMIT ?)', (run_id, count))
                if result.changes:
                    deleted_any = True
                    break
            if deleted_any:
                size = d1.measure_database_size()
                continue
            renew_lease()
            result = d1.execute("DELETE FROM run_logs WHERE run_id = ? AND status IN ('successful','failed')", (run_id,))
            if result.changes != 1:
                raise CloudflareStorageError('Run changed during cleanup.')
            size = d1.measure_database_size()
            if size >= int(state['start_size']) and size > LOW_WATER_BYTES:
                d1.execute('UPDATE retention_state SET run_id = NULL, halted = 1 WHERE id = 1')
                raise CloudflareStorageError('Cleanup stopped because reported D1 size did not decrease.')
            d1.execute('UPDATE retention_state SET run_id = NULL, start_size = NULL, active = ? WHERE id = 1', (int(size > LOW_WATER_BYTES),))
        return {'size': size, 'pending': True}
    finally:
        if owns_lease:
            store.release_run_lease(token=token)
