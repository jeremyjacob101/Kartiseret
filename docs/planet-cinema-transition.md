# Planet Cinema name transition

This change makes **Planet Cinema** the name used by current scrapers, new raw
records, published showtimes, theater metadata, API responses, and user-facing
copy. The venue identity IDs and map locations stay the same.

## What changes

- The now-playing scraper and coming-soon scraper are now named `PlanetCinema`
  and `PCsoon`. New scrape rows and manifests use `Planet Cinema`.
- Current publication rows in `finalShowtimes` and theater map rows are renamed
  by `20261116112748_planet_cinema_name_transition.sql`.
- Public API and client identity boundaries normalize legacy cinema labels so
  old rows still resolve to their existing venue IDs and render with the new
  display name.
- Existing request, Selenium, scraper, and API behavior remains shared under
  the renamed modules; the old production URLs and API endpoints remain valid.
- Existing scraper timing history is reused under the new names when there is
  no new-name timing record. New timings are written under the new class names.

## Historical data policy

Raw rows in `allShowtimes` and `allSoons`, scrape manifests in
`pipeline_scrape_snapshots`, saved logs/artifacts, and existing timing-history
records keep their original names. They document what ran at the time. Runtime
compatibility maps the former `YesPlanet`/`YPsoon` scraper names and `Yes Planet`
venue labels to the current logical source. The publication selector treats
both cinema labels as one source and uses the newest attempt across them, so a
new failed attempt also fences off an older success.

The release-date backfill continues to read archived `YPsoon` artifacts and
normalizes them as the current coming-soon source.

## Database scope

The included data migration updates only:

- `finalShowtimes.cinema`, including venue-suffixed names beginning with the
  former chain label.
- `theaters.chain` and `theaters.theater_name`.

The database columns remain text columns. No table, column, constraint, venue
ID, or foreign key is renamed. Raw scrape history and pipeline manifests are
left intact so old snapshots and retries remain auditable. The migration is
idempotent because it only matches labels beginning with the former name.

## Rollout and rollback

Apply the migration to dev first and verify its row counts and API output. Run
the new scraper/publication path on dev when its runner credentials are
available. For production, deploy the merged application first, then apply the
migration and let the next scrape publish under the new label. The new
application reads both old and new labels during this sequence.

If rolling the application back after the production data migration, reverse
the `finalShowtimes` and `theaters` labels before restoring the old application;
that version only recognizes the former name. Do not rewrite raw history during
rollback.

This PR was tested against the development project only. Production database
and deployment changes are a post-merge cutover step.
