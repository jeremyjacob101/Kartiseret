# Now-playing local release-date backfill

The historical backfill uses the committed scrape artifacts in
`backend/utils/log/logger_artifacts`. It only fills missing dates for visible
now-playing movies whose identity and latest valid date can be established
unambiguously. A parent pipeline run can be marked unsuccessful after an
individual source scrape succeeded; the report records that parent status for
each observation and counts eligible runs by parent status.

## Prepare a database snapshot

Run `backend/utils/supabase/movie_release_date_backfill_snapshot.sql` as a
read-only query against the intended Supabase project. Copy the value of
`release_date_backfill_snapshot` into a JSON file and add `project_ref` using
the project selected in the Supabase tool. The object must retain its
`format_version`, catalog revision, movies, title identities, title fixes,
release dates, coming-soon dates, and run logs.

Run the importer from the repository root:

```sh
python3 backend/utils/supabase/backfill_movie_release_dates.py \
  --snapshot /private/tmp/release-date-backfill-snapshot.json \
  --output-dir /private/tmp/release-date-backfill-report
```

The default window is the 60 days before the generated UTC `as_of` time. Pass
`--as-of 2026-10-26T00:00:00Z` to reproduce a fixed window. The command writes
`report.json`, `movies.csv`, and `apply.sql`; it does not connect to or modify a
database.

## Review and apply

Review the movie statuses, dates, source rows, parent-run status, and identity
evidence in `report.json` and `movies.csv`. Resolve any questionable title
mapping from its artifact evidence before applying it. Conflicting sources in
the latest run, ambiguous identities, and movies without matching history stay
unfilled.

Before applying, take a fresh snapshot after the date migration is installed
and regenerate the report. Confirm the project reference in `apply.sql` matches
the selected Supabase project. Execute that generated SQL once through the
Supabase SQL tool. Its catalog-revision check aborts a stale report, and its
insert only applies to movies still visible with no stored date. If the batch
is stale, export a new snapshot and generate a new report and SQL file.

After applying, query the IDs from the report to confirm that their stored
dates match the proposed dates. Re-run the snapshot and importer; those rows
should report `already_has_date`, and the new report should contain no insert
SQL for them.
