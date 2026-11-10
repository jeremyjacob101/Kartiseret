CREATE TABLE IF NOT EXISTS cleanup_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_successful_cleanup_day TEXT NOT NULL DEFAULT '',
    last_dry_run_day TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO cleanup_state (id) VALUES (1);
