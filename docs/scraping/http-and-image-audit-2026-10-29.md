# Scraper HTTP and image-loading audit — 2026-10-29

This is a point-in-time investigation of all 16 active scraper classes in `backend/config/registry.py`. The live checks ran locally against public sites and did not upload or publish results. A browser run includes Chrome startup, navigation and `logic()`, but not Supabase setup, snapshot writes, or publication. HTTP prototype times include their listing and detail requests and parsing, except where explicitly described as a schedule-only or field-limited comparison. Runs were performed at different times; several browser tests overlapped, sites changed their listings, and caches may have warmed. These are not controlled production benchmarks. No CPU measurements were made.

For the image comparison, the existing scraper logic ran with Chrome's managed image content setting left at its default and then set to block image downloads. A match means the full gathered rows were equal as a multiset, including titles, dates, times, links, and metadata. A difference does not establish its cause. The following records a single pair per class, except where noted.

| Active scraper | Image on: seconds / rows | Image off: seconds / rows | Full output comparison |
| --- | ---: | ---: | --- |
| LevCinema | 74.4 / 471 | 73.7 / 471 | 471 matched |
| RavHen | 47.9 / 263 | 43.0 / 263 | 263 matched |
| MovieLand | 120.2 / 1,159 | 86.8 / 1,059 | 1,059 matched; 100 only in first run |
| HotCinema | 169.2 / 2,773 | 192.3 / 2,832 | 2,758 matched; 15 only in first, 74 only in second |
| YesPlanet | failed at 131.1 | failed at 217.6 | No completed comparison |
| CinemaCity | 303.4 / 3,620 | 292.9 / 3,620 | 3,620 matched in extended retry; both initial runs exceeded 300 s |
| JAFCtheque | 5.5 / 18 | 5.9 / 18 | 18 matched |
| HERZtheque | 187.7 / 71 | 179.8 / 71 | 71 matched |
| HAIFtheque | 92.8 / 63 | 89.0 / 63 | 63 matched |
| JLEMtheque | 69.8 / 170 | 71.9 / 170 | 170 matched |
| TLVtheque | 46.3 / 337 | 48.1 / 337 | 337 matched |
| LCsoon | 33.9 / 19 | 32.6 / 19 | 19 matched |
| YPsoon | 19.8 / 26 | 17.1 / 26 | 26 matched |
| CCsoon | failed at 16.0 | failed at 16.2 | Both timed out waiting for load-more results |
| HCsoon | 47.3 / 48 | 45.0 / 48 | 48 matched |
| MLsoon | 27.1 / 48 | 22.5 / 48 | 48 matched |

The earlier MovieLand pair also had a small number of differences; a reverse-order pair matched all 1,161 common ticket records, with two additional tickets only in the earlier run. Across 954 common tickets in the first pair and 1,161 in the reverse pair, VIP/regular classifications matched. MovieLand detects VIP from an `img` element; blocking its download need not remove the element, but these samples do not establish safety across every site or schedule. Five additional initial-page probes measured 0.61–3.07 MB of image responses per page with images on and zero with images blocked; a separate MovieLand listing probe measured about 6.49 MB. Those are page-level transfer samples, not full-run bandwidth or memory measurements.

A second complete Lev comparison sampled resident memory every 0.5 seconds across each process tree. All 471 rows matched. Summed peak resident sizes were approximately 2,527 MB with Chrome, 2,304 MB with Chrome images blocked, and 132 MB for the HTTP prototype; sampled means were 2,024 MB, 1,905 MB, and 89 MB respectively. Browser processes share memory, so adding their resident sizes can count the same physical pages multiple times. These local concurrent-workload samples are approximate, not physical-memory or production-capacity measurements.

## Direct requests investigation

The HTML column means requesting the site's regular page and parsing its response. The endpoint column means requesting a separate data response used by the site. The latter is not automatically complete or faster end to end: metadata, dates, filters, and ticket links must also match. Prototypes below are investigative scripts rather than production replacements, except for the two already converted classes noted below.

| Active scraper | Regular HTML | Separate data endpoint | Evidence and remaining work |
| --- | --- | --- | --- |
| LevCinema | Full prototype matched 471 rows twice; 35.3–35.4 s versus a 74.4 s browser run. | The location/date endpoint matched all 468 unique browser ticket IDs and times across 49 cinema/date requests in 19.0 s; full metadata still needs movie pages. | Strong HTML candidate. |
| RavHen | Home HTML alone did not contain its dynamic film feed or complete schedule. | Public feed, film-detail and cinema/date schedule endpoints. Fourteen schedule requests took 1.37 s; all 263 captured browser ticket IDs, dates and times matched. | Schedule-only comparison; metadata, formats, links, errors and completeness still need full-output parity. |
| MovieLand | Initial film listing and metadata pages contain useful HTML; theater pages contain client-side templates rather than usable full schedules. | Public events endpoint supplies ticket IDs, times and VIP flags. Six theater requests took under a second; 1,151 ticket IDs overlapped the browser output and their displayed dates, times and VIP flags matched. | A subsequent API-plus-55-film-page prototype took 4.21 s and matched every field for all 1,151 shared browser tickets; eight browser tickets had already started by the later request. A repeat took 4.31 s and matched all 1,143 tickets it shared with the first HTTP run. The API returns dates outside the scraper window, and after-midnight timestamps use the next calendar date, so the displayed business day and coverage must be preserved. A simultaneous or repeated full comparison is still needed. |
| HotCinema | Film listing and sampled film details were present in HTML; theater schedule markup is a client-side template. | Public theater/date endpoint. Across 204 cinema/date requests, 2,750 ticket IDs overlapped the captured browser output; one time differed, and some IDs were present in only one run. The endpoint portion took 9.08 s. | A full replacement also needs film metadata, format/age handling and reconciliation of unmatched IDs. |
| YesPlanet | Initial HTML did not contain the complete dynamically loaded films or schedules. | Public feeds, bilingual film-detail and cinema/date schedule endpoints responded successfully. | Both full image comparison runs failed. The endpoints need a full screening-row comparison; the critical-path potential is high. |
| CinemaCity | Initial HTML contained 12 cards; a browser load-more observation showed 23. Individual film pages contained metadata in HTML. | A Wix dynamic-page request was observed, but a direct replay returned 400; no complete listing/schedule endpoint was established. | Both initial full browser tests exceeded five minutes; extended retries completed. Do not infer completeness from the first 12 cards. |
| JAFCtheque | Production class was converted to HTTP previously. Four paired comparisons matched 18 full rows; medians 4.74 s browser, 2.88 s requests. | No separate screening endpoint observed. Structured screening data was embedded in the page, but it lacks the full film metadata. | Already converted; continue checking live behavior as the site changes. |
| HERZtheque | Full prototype matched all 71 rows twice, at 76.7 and 74.3 s versus 187.7 s browser. | Observed `admin-ajax` request was tracking-related, not an identified complete screening feed. | Strong HTML candidate; prototype cached repeated film pages. |
| HAIFtheque | Initial page contained only 16 cards; event-detail pages included fields. | The site's paginated event endpoint plus event pages yielded 63 rows matching the browser after whitespace normalization, in 45.4 s versus 92.8 s. | Hybrid HTTP candidate. Preserve pagination, empty-page checks and event-specific data. |
| JLEMtheque | Initial page contained one day's calendar, not the full 45-day scrape. | Calendar POST endpoint, after loading each language page in a normal session, matched all 170 browser rows across 45 dates in both languages twice; 38.1–44.2 s versus 69.8 s. | Candidate; preserve language/session handling and explicit empty-day evidence. An initial request without the page session returned 403. |
| TLVtheque | All 60 date pages produced 337 matching rows after whitespace normalization. Two HTTP runs took 73.0 and 2.3 s; browser run 46.3 s. | Booking-related AJAX actions were found in site scripts, but a complete alternative screening feed was not established. | Strong HTML candidate; the wide timing variation needs repeated controlled measurement and empty-page checks. |
| LCsoon | Full HTML prototype matched 19 rows, 16.6 s versus 33.9 s browser. | Lev's location/date endpoint is for screenings; it has not been shown to provide the full coming-soon catalog. | Strong HTML candidate; preserve release-date validation. |
| YPsoon | Initial HTML does not include the full dynamically loaded feed. | Feed plus both language versions of the film-detail endpoint yielded 26 matching full rows in 7.6 s using mappings for the language and rating values present in this sample. | Promising, but production handling and tests for other language/rating values remain. |
| CCsoon | First HTML response contained 12 cards while one browser load-more observation reached 23; film details were server-rendered. | Wix data request was observed but direct replay failed with 400. | Both complete browser runs failed waiting for load-more. Need a reliable complete listing before an HTTP conversion. |
| HCsoon | Full HTML prototype matched all 48 rows twice in 5.9–6.0 s versus 47.3 s browser. | Hot's theater/day schedule endpoint does not establish coverage of films not yet scheduled. | Strong HTML candidate; preserve listing traversal and release-date validation. |
| MLsoon | Production class was converted to HTTP previously. Three full comparisons matched 48 rows; median 27.67 s browser versus 6.88 s HTTP. | Featured-movies endpoint returned six movies; the events endpoint did not cover any of the 63 coming-soon listing IDs in a sample. | Already converted. |

## Recommendation

Prefer targeted conversions, starting with full-row-matched candidates such as Lev, Herzliya, Haifa, Jerusalem, Tel Aviv and Hot coming-soon, with tests for missing or malformed pages, date boundaries, language, and preventing partial snapshots. The Rav-Hen, Yes Planet, MovieLand and Hot schedule endpoints are high-value leads, especially for the longest-running production jobs, but need complete metadata and schedule parity before replacing Selenium. Keep investigating Cinema City's complete listing and schedule.

Do not enable image blocking globally based on this sample: multiple scrapers matched but two full comparisons differed, and two did not complete. A staged per-scraper setting with repeated, independently verified snapshots and resource measurements would provide a safer evaluation. Image blocking is irrelevant for HTTP scrapers that never fetch image URLs. Current code changes are limited to the earlier Jaffa and MovieLand coming-soon conversions; these additional prototypes were not installed in the pipeline.

## Follow-up: full showtime checks for four cinemas

These follow-up checks focus on Rav-Hen, Yes Planet, Hot Cinema, and Cinema City. Full-output parity means equality of all gathered columns, compared as a multiset so duplicate rows are preserved. Browser and request runs were close in time but not atomic; events on the current day can expire during a long browser scrape.

| Scraper | Browser / image-blocked | Requests or endpoint | Exact full-output result |
| --- | --- | --- | --- |
| Rav-Hen | 263 rows: 47.9 s / 43.0 s; all 263 matched in that image-on/off pair. A later normal browser scrape returned 254 rows in 53.9 s. | Public schedule and film-detail endpoints: 254 rows in 5.1–5.8 s across two runs. | Both request runs matched all 254 current browser rows and every field. The tested route is the site's data endpoint, not its initial HTML. |
| Yes Planet | Normal browser completed once at 3,315 rows in 165.9 s. The latest image-blocked run failed after 113.0 s while selecting a date in Haifa; prior full runs also failed. | Public schedule and film-detail endpoints responded in 29.5 s, returning 3,339 events. | Not exact: 24 endpoint events are Russian-dubbed screenings omitted by the browser scraper, and 365 shared rows have different Hebrew-title values (314 Clayface, 51 Street Fighter). Filtering Russian dubs aligns ticket IDs, but titles still differ. No complete request-row replacement or image-on/off parity is established. The ordinary home HTML does not contain the complete feed. |
| Hot Cinema | A prior normal/image-blocked pair returned 2,773 / 2,832 rows in 169.2 / 192.3 s and did not match exactly (2,758 shared rows). A later normal run returned 2,792 rows in 161.7 s. | Regular HTML for film metadata plus the public theater/date endpoint for schedules: 2,789 rows in 21.2 s after normalizing event-name whitespace. | Not exact: 2,787 rows matched, with 5 browser-only and 2 request-only rows. Three browser-only tickets were same-day events no longer returned by the endpoint recheck. Two shared ticket IDs disagree on title and runtime (the browser says “תמונות יפואיות 2”; the endpoint says “Heart of the Beast”). The endpoint is fast, but current full-output parity fails. |
| Cinema City | 3,620 rows in 303.4 s with images and 292.9 s with image downloads blocked; all 3,620 rows matched. | Initial ordinary HTML omits dynamically loaded films (12 cards versus 23 observed after browser load-more). A Wix data-request replay returned HTTP 400; no complete direct schedule route was established. | Image blocking preserved the full output and saved about 10.5 s (3.5%) in this single pair. No exact HTTP replacement is available to compare. |

The only requests-based showtime prototype among these four to meet the current full-row parity check is Rav-Hen. Its observed reduction was about 90% in elapsed time, but it still needs broader date-boundary and field-variation coverage before production conversion. Do not make a widespread change from these results. Image blocking produced a small exact saving for one Cinema City pair and one Rav-Hen pair, while Hot Cinema's pair differed and Yes Planet's latest blocked-image run failed; this does not support a global image setting.

## Disabled scrapers

The registry also contains two disabled cinematheque classes. They were checked separately and remain disabled.

- **Sam Spiegel (`SSCtheque`)**: the regular page returned 31 event cards. Its public WordPress API returned `movie` and `events` records, but sampled records had no populated `acf` screening details, so completeness was not established. The Selenium scraper failed in both image modes because the date text did not have the expected slash-separated format; no full-output or timing comparison is available.
- **Holon (`HOLONtheque`)**: the regular page returned 10 initial event cards. The calendar's public `get_events` endpoint returned 10 event cards for a sampled week. Both full Selenium runs exceeded the three-minute test limit. Neither route has been compared across the scraper's complete date range.
