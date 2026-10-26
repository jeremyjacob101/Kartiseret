# Archived pre-baseline SQL

These six ticket-alert SQL files were present in the repository before PR 2. The active Kartiseret Supabase project had no rows in Supabase's migration ledger and no application migration-history table; its live ticket-alert schema was already in the final account-only state represented by the new baseline. Replaying the historical guest/RPC sequence before that baseline would not bootstrap a fresh copy of the current application schema.

The files below are preserved byte-for-byte here, with SHA-256 checksums, as historical artifacts only. Supabase CLI does not apply files outside `supabase/migrations/`.

The authoritative bootstrap for a clean project is the single current snapshot at `supabase/migrations/20261015141043_current_app_schema_baseline.sql`. Do not restore or replay these archived files. Future schema changes are timestamped SQL migrations created with Supabase CLI, reviewed as SQL, and applied through the Supabase migration workflow. Drizzle maps and queries the tables; it is not a second migration authority.

For an existing project that already has this schema, do not apply the baseline. Establish migration tracking explicitly with the project owner before any future hosted migration operation.
