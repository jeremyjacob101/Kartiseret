CREATE TABLE IF NOT EXISTS run_locks (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    lease_token TEXT NOT NULL,
    run_id INTEGER,
    lease_until TEXT NOT NULL
);

INSERT OR IGNORE INTO run_locks (id, lease_token, run_id, lease_until)
VALUES (1, '', NULL, '1970-01-01T00:00:00+00:00');

CREATE TABLE IF NOT EXISTS run_logs (
    run_id INTEGER PRIMARY KEY,
    target TEXT NOT NULL,
    run_from TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'successful', 'failed', 'unconfirmed')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total_time REAL,
    selected_runners_json TEXT NOT NULL DEFAULT '[]',
    error_type TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scraped_rows (
    row_key TEXT PRIMARY KEY,
    run_id INTEGER NOT NULL,
    scraper TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('successful', 'unsuccessful')),
    row_order INTEGER NOT NULL,
    showtime TEXT,
    english_title TEXT,
    hebrew_title TEXT,
    english_href TEXT,
    hebrew_href TEXT,
    screening_type TEXT,
    screening_tech TEXT,
    original_language TEXT,
    dub_language TEXT,
    date_of_showing TEXT,
    release_year TEXT,
    release_date TEXT,
    directed_by TEXT,
    runtime TEXT,
    rating TEXT,
    screening_city TEXT,
    cinema TEXT,
    source_run_id TEXT,
    extra_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scraped_rows_run_source
    ON scraped_rows (run_id, scraper, attempt, row_order);

CREATE TABLE IF NOT EXISTS gathering_rows (
    row_key TEXT PRIMARY KEY, run_id INTEGER NOT NULL, scraper TEXT NOT NULL,
    source_file TEXT NOT NULL, row_order INTEGER NOT NULL,
    showtime TEXT, english_title TEXT, hebrew_title TEXT, english_href TEXT, hebrew_href TEXT,
    screening_type TEXT, screening_tech TEXT, original_language TEXT, dub_language TEXT,
    date_of_showing TEXT, release_year TEXT, release_date TEXT, directed_by TEXT, runtime TEXT,
    rating TEXT, screening_city TEXT, cinema TEXT, source_run_id TEXT,
    extra_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gathering_rows_run ON gathering_rows (run_id, scraper, row_order);

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    run_id INTEGER,
    artifact_type TEXT NOT NULL,
    artifact_name TEXT NOT NULL,
    object_key TEXT,
    content_type TEXT NOT NULL,
    text_content TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_type
    ON artifacts (run_id, artifact_type, created_at);

CREATE INDEX IF NOT EXISTS idx_run_logs_started_at
    ON run_logs (started_at);

CREATE TABLE IF NOT EXISTS diagnostics (
    diagnostic_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    run_id INTEGER,
    diagnostic_type TEXT NOT NULL,
    diagnostic_name TEXT NOT NULL,
    scraper TEXT,
    attempt INTEGER,
    error_type TEXT,
    error_message TEXT,
    call_chain TEXT,
    outcome TEXT,
    source_url TEXT,
    selector TEXT,
    publication_id TEXT,
    text_content TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY (diagnostic_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_run
    ON diagnostics (run_id, created_at);

CREATE TABLE IF NOT EXISTS retention_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active INTEGER NOT NULL DEFAULT 0,
    run_id INTEGER,
    halted INTEGER NOT NULL DEFAULT 0,
    start_size INTEGER,
    budget_day TEXT NOT NULL DEFAULT '',
    writes_reserved INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO retention_state (id) VALUES (1);
