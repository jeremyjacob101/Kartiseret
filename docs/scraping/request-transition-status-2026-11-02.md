# Requests transition — draft status

The comparison command runs each collector without database writes, publication, notifications, or production timing-history updates:

```sh
PYTHONPATH="$PWD" python3 -m backend.scraping.compare SCRAPER --output docs/scraping/evidence/2026-11-02
```

Add `--first requests` to reverse collector order. Add `--capture-source-responses` when diagnosing a difference; raw public HTTP responses are stored in compressed JSONL with their request identity, status, content type, and SHA-256. Exact comparisons use duplicate-preserving multisets and retain every output value and type, ignoring only generated run/snapshot IDs.

## Full output parity and measured collection time

Each time range below covers complete collection, including browser startup or HTTP session setup, discovery, film metadata, schedule pages, parsing, validation, and cleanup. These are individual scraper times, not whole-pipeline savings. Live site data can change between the two collectors; mismatches stay visible in the evidence and never count as a pass.

| Scraper | Requests implementation | Full parity evidence | Selenium → requests time | Production default |
| --- | --- | --- | --- | --- |
| Jaffa Cinematheque | Requests + bilingual listing HTML | 3 exact full pairs (15/15); reversed order included, plus another exact pair | 6.1s → 1.6s | `auto` |
| MovieLand coming soon | Requests + listing and film HTML | 3 exact full pairs (48/48), plus another exact pair | 25.1s → 7.7s | `auto` |
| Lev showtimes | Requests + bilingual listing and film HTML | 4 exact full pairs (209/209), including reversed order and post-guard runs | 69.8–74.4s → 33.9–37.2s | `auto` |
| Lev coming soon | Requests + bilingual listing and film HTML | 3 exact full pairs (19/19), reversed order included | 31.0–32.8s → 15.3–18.0s | `auto` |
| Yes Planet coming soon | Requests + public feed/detail API | 3 exact full pairs (39/39), after mapping the source's Hindi language | 23.9–26.0s → 8.7–10.4s | `auto` |
| Hot Cinema coming soon | Requests + listing and film HTML | 3 exact full pairs (50/50), reversed order included | 42.5–49.2s → 6.7–8.4s | `auto` |
| Tel Aviv Cinematheque | Requests + date-page HTML | 3 exact full pairs (345/345) after matching whitespace and Hebrew-only title behavior; reversed order included | 47.3–49.9s → 2.1–2.4s | `auto` |
| Herzliya Cinematheque | Requests + listing and film HTML | 3 exact full pairs (83/83), reversed order included | 241.5–276.8s → 73.2–79.1s | `auto` |
| Haifa Cinematheque | Requests + paginated event AJAX and detail HTML | 3 exact full pairs (53/53), reversed order included; 60 source cards processed using 65 HTTP requests per full collection | 84.8–92.2s → 43.7–46.7s | `auto` |
| Hot Cinema showtimes | Requests + theater/date JSON API and film HTML | 3 exact full pairs (1,764/1,764), reversed order included. The first attempt failed closed on an empty date; explicit empty-date evidence now validates it. | 135.0–150.4s → 20.7–21.6s | `auto` |
| Jerusalem Cinematheque | Requests + bilingual calendar AJAX POST | 3 exact full 45-day pairs (141/141, 141/141, 166/166), both execution orders; later source data added 25 rows and the latest source capture covered all 45 date tokens and both language pages | 65.2–68.5s → 42.9–46.1s | `auto` |
| Rav-Hen showtimes | Requests + Quickbook catalog, dates, event, and film APIs | 5 later exact full pairs (187/187). One earlier Selenium run returned 109 November rows while requests returned 187 November/December rows; the cause remains unresolved. | Matching runs 36.2–43.6s → 2.5–3.7s | Selenium |
| MovieLand showtimes | Requests + event API and film HTML | Two earlier pairs matched 587/587. Latest guarded run returned 587 Requests rows vs 585 Selenium rows (two Nov 2 Glilot events); the next reversed-order run found only 28/49 catalog films and 55 unlisted schedule-film references, so Requests failed closed while Selenium completed 582 rows. Keep the browser default. | Latest completed pair: 67.9s Selenium, 6.2s Requests; reversed run failed closed at 4.8s Requests | Selenium |
| Yes Planet showtimes | Requests + Quickbook catalog, dates, event, and film APIs | 3 exact complete pairs: 2,331/2,331, 2,305/2,305, and 2,301/2,301, with both execution orders. Two intervening full pairs differed by 5 and 4 current-day rows as the live schedule changed; those artifacts are retained and each was followed by a complete rerun. The final pair captured 284 HTTP responses, covered 6/6 cinemas and all 101 discovered dates, and skipped 3 untitled cards with no ticket links. An untitled card with bookings now fails closed. | Exact pairs: 138.2–142.9s → 26.1–37.8s (about 73–82% faster per scraper run) | `auto` |
| Cinema City showtimes | No complete independent HTTP schedule route established | Browser catalog has 12 initial cards and loaded further results; full scraper emitted 3,620 rows in the prior extended run. A Wix dynamic-page request replay returned HTTP 400; showtime options/ticket IDs are not present in the plain page response. | No complete requests result | Selenium |
| Cinema City coming soon | No complete independent HTTP catalog route established | Direct HTML exposes 12 initial films; browser pagination has reached 23, but load-more currently times out. First-page-only comparisons are not accepted as complete. | No complete requests result | Selenium |

The table labels the *data route*, not a different networking library: an API call is still made using Python `requests`. For sources with schedules in JSON/AJAX, the collector calls that public endpoint; for sources exposing complete data in page HTML, it requests and parses the page. Several sites do not expose a complete API or a stable paginated HTTP route, so there is no valid second implementation to benchmark there.

## Safety and remaining verification

- `auto` tries one complete requests collection and validates its columns/result. Any request or validation error marks that snapshot failed, discards all partial HTTP rows and state, then performs one fresh Selenium collection. Upload/publication failures do not trigger another collection.
- Chrome is lazy-created only for Selenium. Requests sessions are scoped to one collection. GETs use bounded retries and 10/30 second connect/read timeouts; Jerusalem's read-only calendar POST enables the same bounded retry policy.
- A correctly dated Jerusalem calendar response with an empty event container is recorded as a source-confirmed empty date. The legacy browser skips 9 blocks missing titles and 19 blocks missing required detail fields; the requests collector counts and mirrors those existing skips. Three complete 45-day comparisons match exactly.
- Yes Planet's Requests and Selenium comparisons include exact runs at different row counts because the source schedules changed during the day. The 5-row and 4-row mismatches are preserved in evidence, and complete reruns after the source changed matched exactly. The latest run also verifies that untitled cards without booking links add no rows; cards with links still fail validation.
- Focused samples, full-output pairs, failed attempts, mismatches, and captured public responses are preserved in `docs/scraping/evidence/snapshots-2026-11-02.tar.gz`. Some earlier artifacts predate final fixes; failed and mismatching evidence is retained, not excluded.
- The full backend suite passed: 370 tests. No total pipeline percentage is claimed because the collection jobs run concurrently; a normal-scheduler benchmark remains unrun, so the figures above are per-scraper collection times only.
- PR #214 remains draft; no reviewers are requested.
