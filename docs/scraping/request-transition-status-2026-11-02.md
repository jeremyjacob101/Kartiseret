# Requests transition — draft status

Full comparisons use the read-only `python -m backend.scraping.compare SCRAPER --output DIR` command. It runs independent collectors, records complete rows and elapsed times, and compares duplicate-preserving multisets without discarding field or type differences. Existing runs were made against the live site, so they are not atomic snapshots. Run artifacts include failed and discrepant comparisons as well as successful ones.

| Scraper | Default | Full comparison evidence |
| --- | --- | --- |
| Jaffa Cinematheque | Requests with browser fallback | Three pairs: 15/15 exact each; reversed order included. A fourth harness run matched 15/15. |
| MovieLand coming soon | Requests with browser fallback | Three pairs: 48/48 exact each; reversed order included. A fourth harness run matched 48/48. |
| Lev showtimes | Requests with browser fallback | Four pairs: 209/209 exact each, including a run after the current-film schedule guard. Browser 69.8–74.4 s; requests 33.9–37.2 s. |
| Lev coming soon | Requests with browser fallback | Three pairs: 19/19 exact each; browser 31.0–32.8 s, requests 15.3–18.0 s. |
| Yes Planet coming soon | Requests with browser fallback | Three pairs after adding the observed Hindi language mapping: 39/39 exact each. Earlier attempts failed closed on that unrecognized language. |
| Rav-Hen | Selenium | One browser run returned 109 November rows while the independently discovered API result contained 187 November/December rows; four subsequent full pairs matched 187/187. The cause of the browser's missing December rows remains unresolved. The requests collector is available for further testing but is not the default. |
| Tel Aviv Cinematheque | Selenium | Three full pairs matched 343/343 after fixing whitespace handling. A later full pair exposed two Hebrew-only title differences after the source added events; the collector was corrected and is being rechecked. |
| Other active scrapers | Selenium | Focused experiments exist, but complete production collectors and full-output validation have not yet been completed. Cinema City schedules remain unresolved. |

Requests failures in `auto` fail the initial snapshot, discard collected rows, and start a fresh browser snapshot. The fallback does not run for upload errors. HTTP calls use isolated sessions, bounded GET retries, and connect/read timeouts. Transport artifacts record observed request and retry counts, elapsed time, rows, coverage, and failure type; a retry count may be incomplete when the final connection attempt raises before returning a response.

No total pipeline speedup is claimed. Browser baselines include normal Chrome startup and discovery; requests timings include listing, detail pages, schedule calls, parsing, and cleanup. The site's changing schedule, network caching, and concurrent local activity affect timings. Some request captures in the evidence directory predate the final diagnostics-only instrumentation; their full extracted rows remain available for comparison.

Outstanding before this draft is ready: finish full collectors and repeated exact comparisons for the remaining eligible scrapers; resolve the Rav-Hen and Tel Aviv discrepancies; capture the source responses needed to diagnose future parity failures; run a normal-scheduler end-to-end benchmark; and rerun the complete backend suite on the final revision. No reviewers should be requested automatically.
