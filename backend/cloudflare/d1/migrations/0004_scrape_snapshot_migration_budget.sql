CREATE TABLE IF NOT EXISTS snapshot_migration_budget (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    day_utc TEXT NOT NULL,
    reserved_writes INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO snapshot_migration_budget (id, day_utc, reserved_writes)
VALUES (1, '', 0);
