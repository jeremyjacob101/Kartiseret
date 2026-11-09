# Cinema City homepage discovery and age restrictions — November 9, 2026

The films **were on the homepage**. The earlier explanation that they were permanently omitted from the website was wrong. Our Selenium selectors targeted the inner poster panels rather than the persistent movie cards.

## Confirmed homepage bug

The site's public page code switches a movie's multi-state box from `posterState` to `selectionState` on mouse entry. In the captured live DOM, Tosca's outer repeater item (`comp-mkmrxabz__6675`) and details panel existed while its poster panel (`comp-mpkxxq0h__6675`) did not. The former selector therefore missed a film that was still present on the page. The pointer position and state transitions explain why separate runs missed different films and why the user's homepage screenshots contradicted our initial explanation.

Both discovery and pagination now use persistent repeater items:

| Collector | Old inner panel | Persistent outer item |
|---|---|---|
| Showtimes | `comp-mpkxxq0h__` | `comp-mkmrxabz__` |
| Coming soon | `comp-mrjafvop__` | `comp-mrjafvoi1__` |

The Requests collector did not need an additional source or new film IDs. The Selenium collector still uses the ordinary homepage and its show-more button, then visits the discovered movie pages. **No sitemap code is included.** The fixture/regression test exercises both poster and alternate details states for both collectors, and verifies that actual collector discovery retains both films in either state.

Unexpected redirects away from a discovered film now fail the browser attempt. A bookable homepage film's cinema control must initialize with actual choices; a temporarily disabled control no longer silently skips the film. Failure preserves the existing whole-attempt publication safeguards rather than publishing the other films as complete.

## Full-run evidence

Complete outputs, source responses, and every mismatch are retained in the [manifest](evidence/2026-11-09/cinema-city-homepage/manifest.json) and [comparison archive](evidence/2026-11-09/cinema-city-homepage/comparisons.tar.gz). The initial unpatched rerun found all 50 dubbed Forgotten Island screenings but still missed Tosca and other rows. After changing the selectors, the first full pair had 2,310 exact shared rows and three future December show rows only in Requests. Those three were not dismissed as expiry. The reverse pair matched 2,313/2,313; the subsequent fail-closed browser guards eliminate the two explicit silent-skip branches. Complete guarded runs also matched 2,313/2,313.

Both reported films are now included through ordinary homepage discovery: all **50 האי הנעלם־מדובב screenings** and **two אופרה בשלייקס: טוסקה screenings**. No differing rows were deleted or normalized away to obtain an exact pass.

## Age restrictions

The `rating` output field means age restriction, not a review score. Both transports preserve the shared existing mappings: `טרם נקבע` → null, `מותר לכל` → `All`, and `הותר מגיל 9` → `9+`.

Cinema City's feature records changed at **2026-11-09 10:02:19.664 UTC (12:02:19 Israel time)**: How to Rob a Bank and Ramayana changed from unassigned to 9+, and The Fugitive changed from unassigned to all ages. A Selenium-first full pair that crossed that update had the same 2,313 ticket IDs but 54 age-field differences. A later pair still saw 28 older age values on browser pages while the API already exposed the new values. Targeted fresh-page observations subsequently showed the current all-ages/9+ values immediately, after waiting, and after a cinema selection. The later full current-age comparisons matched **2,313/2,313 exactly across every field in both orders**: Requests-first (2.1s versus 230.8s Selenium), then Selenium-first (229.0s versus 2.2s Requests).

No production age-value override or special case for these films was added. The additional collector regression verifies unset, all-ages, and 9+ values, including separation between films and collection attempts. Website changes and differences in when HTML/API sources update remain visible in the retained evidence.

## Checks and deployment

- All **692 backend tests passed**, including card-state discovery, ignored pagination clicks, terminal pagination behavior, fatal redirects, loading controls, and age restrictions.
- The [fleet report](full-retest-2026-11-09.md) now includes exact complete pairs for all 17 enabled scrapers. Holon remains disabled.
- Requests remains preferred with clean whole-Selenium fallback. Production does not collect both transports to compare them.
- No merge, hosted migration, production catalog publication, or notification was performed during this follow-up.
