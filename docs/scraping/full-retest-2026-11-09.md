# Complete transport recheck — November 9, 2026

All 17 enabled scrapers were collected completely with both transports, without database uploads, publication, notifications, or timing-history writes. Output comparisons preserve every field, value, type, and duplicate. Holon remains disabled. No merge was performed.

All **17 enabled scrapers now have exact complete Selenium/Requests pairs**. Cinema City showtimes now matches **2,313/2,313 across every field**, including the current age restrictions; its coming-soon collector matches **47/47**. The earlier Cinema City exception is resolved: our Selenium selector targeted a replaceable poster panel, so a card in its alternate details state could be skipped even though it was on the homepage. Both collectors now count and discover the persistent outer movie cards. No sitemap workaround is used. See [the homepage diagnosis and retained comparisons](cinema-city-homepage-fix-2026-11-09.md).

## Latest qualifying pairs

Times include setup, discovery, metadata, schedules, parsing, validation, and cleanup. Different pairs ran at different times and some ran concurrently; these are not a normal-scheduler pipeline benchmark.

| Scraper | Selenium | Requests | Result |
|---|---:|---:|---|
| LevCinema | 70.1s | 34.1s | 207/207 exact |
| RavHen | 40.5s | 6.5s | 238/238 exact |
| MovieLand | 96.7s | 7.8s | 891/891 exact |
| HotCinema | 136.5s | 36.3s | 2,191/2,191 exact |
| YesPlanet | 102.0s | 34.8s | 2,997/2,997 exact |
| CinemaCity | 229.0s | 2.2s | 2,313/2,313 exact |
| JAFCtheque | 4.1s | 1.5s | 28/28 exact |
| SSCtheque | 5.3s | 1.5s | 23/23 exact |
| HERZtheque | 133.7s | 60.1s | 50/50 exact |
| HAIFtheque | 71.6s | 29.4s | 46/46 exact |
| JLEMtheque | 82.3s | 41.9s | 116/116 exact |
| TLVtheque | 143.4s | 4.0s | 302/302 exact |
| LCsoon | 32.6s | 15.1s | 20/20 exact |
| YPsoon | 19.4s | 7.0s | 27/27 exact |
| CCsoon | 34.5s | 0.7s | 47/47 exact |
| HCsoon | 87.6s | 8.6s | 47/47 exact |
| MLsoon | 24.2s | 5.6s | 40/40 exact |

## Fixes and investigations

- **Yes Planet Selenium correctness fix:** on a sparse date, Quickbook automatically selects its only film. The selection can persist when a later date contains more films. Full browser traces showed `for-movie=8105s2r` on December 16 while Requests exposed 515 Avengers screenings across December 16–19. The browser now clears the native movie dropdown through its existing change handler whenever multiple films are available, waits for the unfiltered route, then reads all screenings atomically. No film IDs or screening IDs are hardcoded in production. The previously missing 515 screenings are included in the exact post-fix full pairs.
- **Quickbook response readiness:** date changes now wait for the selected date’s own completed film-events response. Resource timings are cleared before each click so the browser’s default timing buffer cannot fill on long runs. Selecting the already-current date does not require a new request. Rav-Hen was fully rerun after the shared change and remained exact.
- **Lev Requests:** Wildwood is listed without any schedule container. Its live HTML and Chrome both show a named but empty booking form. Requests now accepts that narrow empty structure, while malformed/missing structures or remaining ticket controls still fail. The complete post-fix pair matched 207/207.
- **MovieLand showtimes:** the first pair matched all 778 browser rows with 113 HTTP-only rows. The reversed pair matched 891/891 exactly. Both original outputs remain archived; no rows were excluded to manufacture a pass.
- **Hot Cinema showtimes:** the initial pair had 2,166 exact shared rows, five browser-only and four HTTP-only, including three changed Atmos flags. The reversed complete pair matched 2,191/2,191. HTTP made 766 requests with zero retries in the first run: 636 theater/date checks, 105 film details, plus theater/filter/listing calls. Eight populated dates were missing from the site’s date filter. The full current-and-next-month calendar checks preserve those screenings; skipping them is not a safe optimization. Requests took 36.3–39.5s versus Selenium 136.5–153.7s.
- **Cinema City coming soon:** the first pair had 47 exact shared films and one HTTP-only Phantom of the Opera. The reversed full pair matched 48/48.
- **MovieLand coming soon:** the first browser attempt timed out; Requests succeeded. A reversed complete pair then matched 40/40. Both attempts are retained.

## Production verification (read-only)

The latest production Yes Planet snapshot was run 685, started November 8 at 19:03:38 UTC (21:03 Israel time), completed with 2,492 rows. Each of the 515 specific Avengers ticket URLs was checked: zero were present in its raw output and zero in the published catalog; all 515 were present in older raw data. Thus the omission affected production, despite the run being marked successful. No production catalog rows were changed during verification.

The previously authorized transport-history migration had already been applied before the instruction to leave deployment to the user. Its checks preserved all 243 original production history rows and their original-field digest. This retest does not merge or perform further production writes.

## Verification and evidence

- 692 backend tests passed after the fixes, including atomic ticket extraction, filter reset, current-date selection, response readiness, and Lev empty-booking evidence.
- The independent comparison command is `python -m backend.scraping.compare all --output DIR --capture-source-responses --workers 3`. Reversed pairs use `--first requests`.
- [Manifest](evidence/2026-11-09/full-retest/manifest.json) lists **every** complete pair, mismatch, timeout, row count, coverage summary, request count, and archive path. [Captured outputs and source responses](evidence/2026-11-09/full-retest/captures.tar.gz) include failed attempts as well as successful reruns, direct Cinema City browser proof, and Yes Planet diagnosis.
- Runtime fallback remains Requests first, then a clean whole Selenium collection on observable collection/validation failure. It does not compare both outputs in production and cannot guarantee detection of all silent source changes.

No percentage claim about total pipeline speedup is made.

The subsequent Cinema City homepage fix adds [a separate evidence manifest](evidence/2026-11-09/cinema-city-homepage/manifest.json) and retained [full captures](evidence/2026-11-09/cinema-city-homepage/comparisons.tar.gz). These include the mismatches during the source age-restriction update; no differing rows were excluded to obtain an exact result.
