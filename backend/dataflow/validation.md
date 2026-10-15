# Dataflow request validation — October 15, 2026

Baseline: current main `c845bcb8`. The benchmark uses private copies of read-only Supabase snapshots and the actual baseline/branch Python classes. Production database client creation, notifications and cleanup utilities are blocked. No production writes occurred.

## Changes

- The three TMDB mappers use a five-worker executor for candidate details. Ordered map results preserve fix, director, runtime and first-candidate precedence, as well as all ten correction alternatives. Search stops at positive total_pages or the API’s 500-page bound, without stopping merely because a page contains only duplicate IDs.
- Per-worker/per-host sessions reuse connections. Successful TMDB payloads are cached and concurrent identical requests share one in-flight result within the run's shared request context. Failed requests and missing movies are not cached as successes.
- HTTP retries are driven by observed connection/read errors, 429/selected 5xx, and invalid TMDB payloads. Auth/parameter failures stop immediately. Retry-After is respected; excessive server delays stop recovery rather than retrying early. Query strings/API keys are excluded from request exceptions.
- Letterboxd resolves the intended movie endpoint first. Healthy requests avoid the homepage. Recovery still has ten legacy bootstrap attempts, with fresh sessions after challenges; healthy sessions remain reusable. LB and RT parse independent fields concurrently in a shared bounded pool after TMDB prefetch.
- IMDb downloads are shared in a temporary cache and revalidated with ETag/Last-Modified. Immutable content-addressed gzip files and atomic metadata replacement avoid mixed versions. Header/EOF/CRC/digest validation protects the cache, and changed file signatures invalidate validation results. Dataset projection uses csv.reader and includes newly supplied TMDB external IMDb IDs.
- Missing/unresolved mappings remain eligible for correction. An unhealthy cinema retains old screenings. Final movie publication precedes stale-row deletion and added flags; now-playing also recovers missing referenced movies on a retry. Existing ranking, skips, title aliases, source release dates and RT parser are preserved.

## Full live comparison

| Stage | Input rows | Main seconds | Branch seconds | Faster | HTTP requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| Coming soons Tmdb | 432 | 502.0 | 204.1 | 59.3% | 2,154 → 1,526 |
| Coming soons Update | 79 | 9.4 | 9.4 | 0.4% | 79 → 79 |
| Now-playing Tmdb | 11,471 | 278.0 | 145.2 | 47.8% | 1,174 → 1,014 |
| Now-playing Update | 157 | 77.8 | 64.3 | 17.3% | 930 → 773 |
| Cinematheques Tmdb | 488 | 734.5 | 362.1 | 50.7% | 3,041 → 2,701 |
| Cinematheques Update | 249 | 132.3 | 98.9 | 25.3% | 1,458 → 1,209 |

Total of these independent measured stages: **1734.0s → 883.9s (49.0% less time)**. This is a full private reprocessing comparison, not a timed production Clean → Tmdb → Update schedule. The Update stages use the same initial final-table snapshots in both versions rather than feeding one benchmark’s mapper output into another benchmark.

Mapping inputs: 432 raw soon rows, 11,471 rows from each cinema’s latest now-playing snapshot, and 488 latest cinematheque rows. Raw added flags were reset only in memory so the same complete workload was resolved on both sides; past-date and skip filtering remain active. This deliberately measures reprocessing rather than the usually smaller pending subset in a daily run. Updates cover all 79 coming-soon, 157 now-playing and 249 cinematheque movie rows.

The baseline completed before branch live measurements began. The transport paced both sides to roughly 8.3 requests/second per hostname, below the implementation’s 10/second instance limit. Capture, parsing and in-memory query/upsert/deduplication costs are included. Actual Supabase network latency, cleanup utility calls, movie-code minting, scraping and notification delivery are excluded. Network/CDN conditions can vary; these timings are observations, not daily runtime guarantees.

IMDb’s cold download/validation and later conditional revalidation are included in the corresponding live Update timings. The cache is shared across the two movie Update classes; a 304 is still a request, but avoids another full dataset download. No precomputed IMDb subset was substituted for the branch’s live helper.

## Output checks

All three mapping workloads and all 485 Update rows were also replayed against the saved baseline HTTP responses. Every matching decision and alternate option is preserved. Coming-soon mapping and Update fields match exactly. Now-playing and cinematheque movie metadata match exactly; screening/raw completion differences below are intentional safety corrections. One now-playing Update receives an IMDb rating and vote count for a newly discovered ID that the previous preload missed.

- Now-playing: 671 unresolved raw rows stay pending; 387 old screenings are retained during incomplete resolution.
- Cinematheques: 26 unresolved raw rows stay pending; 91 old screenings are retained.
- IMDb: Panther Pat (TMDB 1626328 → IMDb tt39363050) receives the captured dataset’s 9.6 rating and 7 votes in the same run. Other replayed Update fields are identical.

Independent live responses can change popularity, ratings and counts between runs. Each live difference is classified against replay and saved response bodies; dynamic source values are not silently ignored to manufacture exact-match claims. All 1,339 live differences were verified: 162 changing provider fields, 697 intentionally pending raw flags, 478 protected old screenings, and the two newly available IMDb fields. No unclassified differences remain.

## Regression checks

Run from the repository root:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s backend/tests -v
python -m compileall -q backend
git diff --check
```

The 31 network-free unittest methods include subcases for all three mapper classes and the relevant statuses. Coverage includes out-of-order completion, a five-request worker bound, shared successes/copy isolation, non-cached errors, malformed or declared-error payloads, authentication failure, Retry-After/queue budgets, missing candidate/enrichment data, duplicate-only pages, finite missing-page metadata, direct Letterboxd success, challenged-session reset, tenth-bootstrap success, resource cleanup, atomic/corrupt/truncated/digest-mismatched IMDb caches, dataset-version changes, new external IDs, partial final-movie failure/retry repair and missing-movie recovery. These checks run in Full checks CI.

A separate private matrix exercised 78 actual-source provider cases, including normal and solo-update rows, optional metadata, RT overlays/search fallback, malformed responses, persistent challenges, cold sessions and transient errors. Preservation cases match every field; 429/503 cases intentionally recover additional Letterboxd data.

## Current limitations

1. Socket inactivity and retry scheduling are bounded, but DNS/slow trickle responses and executor shutdown do not have an enforceable whole-process deadline. Legacy Letterboxd fallback can still be expensive when the target is actually challenged.
2. Publication uses multiple Supabase operations, not a transaction. Added flags and stale deletion are deferred until both final tables succeed, and missing movie recovery repairs common partial failures, but readers can briefly observe mixed snapshots and arbitrary failures still need retry/reconciliation.
3. An unresolved/invalid snapshot conservatively blocks stale deletion for its whole cinema. This prevents data loss but can retain outdated upcoming screenings until fixes/skips resolve the snapshot. Successful rows can be revisited while another row remains unresolved.
4. RT’s existing year-proximity matcher can choose an unrelated title, and numeric zero can be treated as missing. The recorded Madama Butterfly / Butterfly Effect 3 mismatch remains a separate correctness issue; changing identity matching or parsing was outside this performance PR. Existing TMDB fallback-first matching likewise still depends on manual fixes/skips for ambiguous titles.
5. Providers may be blocked, change HTML, or have no listing/rating. Normal updates retain prior values; rows can remain stale. Solo-update retains its existing clearing semantics. Unhandled row failures are now noted, but the existing Update policy can still finish after skipping failed rows.
6. IMDb only covers IDs present in its dataset. The cache needs writable temporary storage; multiple processes may duplicate downloads/projections despite atomic versions. HTTP validators must be trusted for freshness. Per-instance HTTP pacing does not impose a global limit across other processes.
7. Separate processes still have independent request pools and host pacing. A retry can repeat non-TMDb provider work, and unrelated concurrent runs are not coordinated by the run-scoped request context.

## Remaining opportunities

- Add an enforceable process deadline and structured cancellation/retry ownership; a Future timeout alone cannot stop an already running HTTP request.
- Reuse TMDB payloads across mapping and Update within the same run, with explicit freshness and failure rules, to avoid repeat enrichment calls.
- Make unresolved protection and stale cleanup more precise per title/snapshot, with durable match checkpoints that preserve grouping/alias semantics.
- Validate RT identity using titles, original/translated aliases and remake years; preserve numeric zero; verify stored RT links before considering skipping search.
- Store provider freshness/failure information and distinguish fresh scores, retained old values and genuine no-listing results in operational reporting.
- Project the union of IMDb IDs once for an entire run or maintain a versioned index if profiling justifies it, rather than loading a large all-title dictionary. Overlap prefetch/provider stages only after preserving dependency and concurrency constraints.

No schema changes or new runtime dependencies. No reviewer requests.

## Shared runner verification

The runner now schedules all selected scrapers through six slots and runs selected dataflows behind Clean, TMDB, and Update barriers. A run-scoped request context shares TMDB successes and in-flight calls across those stages. The combined Update stage prefetches TMDB once for its selected rows, reads IMDb ratings once for the categories that use them, and processes rows in one five-worker pool.

The network-free suite now contains 50 tests, including exhaustive comparisons for small scheduler inputs, 16-job scheduling, six-worker capacity and retry behavior, category failure isolation, update-only selections, cross-instance request sharing, and combined Update prefetching. The exact search completed within 0.014 seconds in the slowest of 30 synthetic 16-job timing sets tested locally.

These checks do not replace a full reprocessing benchmark of the new orchestration. The workspace contains no isolated copy of the complete live source and final-table snapshots, so no old-versus-new end-to-end schedule comparison was run. The timings in the table above remain measurements of independent legacy stages and should not be read as results for the shared runner.
