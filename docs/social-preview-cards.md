# Static movie social preview cards

Movie pages use one immutable, pre-rendered JPEG card for both plain movie
links and city/date showtime links. The page title and description still follow
the URL. Until a card fingerprint has been published, metadata falls back to
the movie poster. The homepage uses the checked-in `public/og/home.jpg` file.

## Data and object identity

- Cards are generated from the same normalized catalog data used by the web
  renderer: current title, poster/backdrop URLs, playing status, year, release
  date, runtime, up to three genres, and ratings/vote totals displayed on the
  card.
- A shared SHA-256 fingerprint includes the renderer version. Bump
  `SOCIAL_PREVIEW_RENDERER_VERSION` when the card layout, overlays, fonts,
  logos, or output changes.
- R2 keys are `social/v1/<64-lowercase-hex-fingerprint>/card.jpg`. They are
  immutable; changed data produces a different URL.
- The worker uses only TMDB image URLs on `image.tmdb.org` or artwork paths in
  the selected R2 bucket. It never fetches an arbitrary catalog URL. Source
  reads are bounded to 10 MiB and 20 million decoded pixels; output is limited
  to 2 MiB.
- A successful upload is verified in R2 before the catalog fingerprint is
  updated. Failed source reads, renders, uploads, or raced catalog changes do
  not publish the new fingerprint. The normal next scrape retries them.
- Old card objects are intentionally retained in this change. They may still
  be used by cached social posts; any future reclamation needs a complete
  reference check and a grace period.

## Configuration

No new secrets or environment variables are required. Dataflow reuses the
selected environment's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and R2
writer settings (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_IMAGE_ORIGIN`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). The app endpoint reuses the
selected environment's R2 read-only pair. The existing local DEV/PROD target
selector must resolve Supabase and R2 as a matching pair. Vercel Preview must
use the development Supabase project and development bucket; Vercel Production
must use the production project and production bucket.

The dataflow host needs Node.js 24, the repo's installed npm workspace
dependencies, `tsx`, and `sharp`. After each successful catalog publication,
the dataflow builds the small shared contracts/server packages and runs one
long-lived Node worker for the scan. Missing local R2 configuration skips the
best-effort hook. A worker/build/database error is logged and does not roll
back a successful catalog publication.

## Deployment and backfill order

1. Apply the additive migration
   `supabase/migrations/20261103175000_social_preview_fingerprints.sql`
   to the development Supabase project. The new server selects this column, so
   the migration must precede that server deployment.
2. Ensure the Vercel Preview environment has the development app's read-only
   R2 credentials and the development Supabase project settings already used
   by the app. Deploy the branch preview and confirm a catalog API response
   accepts `socialPreviewFingerprint` as an optional field.
3. Preview a controlled backfill first:

   ```sh
   python -m backend.dataflow.social_previews --target development --limit 1
   ```

   This is a dry run. To write one controlled development card, run:

   ```sh
   python -m backend.dataflow.social_previews --target development --apply --limit 1
   ```

   The command resumes naturally: already published matching fingerprints and
   verified objects are skipped on later runs. Do not use production as the
   development test target.

4. Verify the exact returned fingerprint at
   `https://<development-app-origin>/api/images/social/v1/<fingerprint>/card.jpg`.
   Check the JPEG, the immutable cache headers, and both the short movie link
   and an encoded city/date share link. Both HTML responses should point to
   the same card URL while retaining their respective title/description.
5. Backfill the remaining development catalog in bounded `--limit` batches;
   omit `--limit` only after the small pass succeeds. Normal successful
   catalog publications then keep cards current automatically.
6. Before any production rollout, apply the additive migration to production,
   confirm the production app's read-only and dataflow writer credentials map
   to the production bucket, and deploy the production server. Production
   migration, backfill, and dataflow writes require explicit authorization;
   they are not performed by this PR or its verification.
7. Backfill production in small approved batches after deployment, verify the
   published card endpoint and real page metadata, then continue with the
   remaining catalog. Scraper refreshes thereafter handle changed card data.

The CLI defaults to dry-run. `--apply` writes the selected database and bucket;
production requires the additional `--allow-production` flag. `--limit` counts
items that need work, rather than rows already complete, so rerunning a batch
continues from the remaining catalog.

## Monitoring and recovery

After a refresh, logs report scanned, updated, unchanged, failed, stale, and
pending counts. Updated cards have been uploaded, verified, and published; they
are removed from the pending count. Pending counts discovered cards still needing
work (including dry-run candidates, failed uploads, and raced updates). The live
counter reports catalog rows checked, including unchanged rows. Individual failures include the table/key and error class but
not URLs, source bytes, or credentials. A failed refresh keeps the current
fingerprint unchanged. A source change during rendering leaves the uploaded
object unreferenced and does not publish its pointer; the next scan retries
the current data.

The image endpoint accepts only the exact v1 fingerprint path and `card.jpg`
filename. Successful objects are returned as JPEG with `nosniff` and immutable
one-year browser/CDN caching. Missing objects and storage failures are
uncached. Legacy `/api/og-image` requests redirect to the static card (or the
poster during backfill); they no longer download images or render on request.

To roll back, redeploy the prior application/dataflow version. The nullable
fingerprint columns are additive and should remain in the database; the prior
app ignores them. Already-cached social previews and immutable R2 objects
remain valid. Do not delete the card prefix as part of rollback.

Regenerate the static homepage asset after intentionally changing its design:

```sh
npm run web:og:home:build
```
