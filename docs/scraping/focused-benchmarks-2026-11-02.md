# Focused scraper benchmarks — 2026-11-02

This records the initial focused probes only. The later full-output comparisons, final production defaults, latest timings, and unresolved sources are documented in [the request-transition status](request-transition-status-2026-11-02.md).

Timings include browser startup or HTTP session creation, listing retrieval, and the film metadata and screening fields needed for the selected output. Except where marked full, the browser scraper stopped after ten gathered rows; the request prototype collected the corresponding focused subset. Full-row comparisons use every gathered field and preserve duplicate rows. These are live, non-atomic snapshots; the site may change between runs.

Two browser runs and two request runs were used for each sample unless noted. The first browser pass ran up to three scrapers at a time; the second ran sequentially. Request runs were sequential. Times are local elapsed seconds and include network variation and caching. They are not controlled production pipeline timings or memory/CPU measurements. Selenium sometimes reads metadata for the whole listing before emitting the first ten rows, whereas request prototypes fetch only the data necessary for the selected rows; that difference is part of the potential optimization, but these are not full-catalog comparisons.

| Scraper | Selenium seconds | Requests seconds | Comparison and method |
| --- | ---: | ---: | --- |
| Lev showtimes | 3.6–4.2 | 0.47–1.10 | 10/10 exact; page HTML |
| Rav-Hen showtimes | 44.1 | 2.0–4.2 | 187/187 exact, full snapshot; schedule and film APIs, one browser and three request runs |
| MovieLand showtimes | 37.0–40.4 | 0.62–0.83 | 10/10 exact; schedule API plus film HTML |
| Hot Cinema showtimes | 58.1–67.1 | 0.72–0.75 | 10/10 exact; schedule API plus film HTML |
| Yes Planet showtimes | 57.5–64.6 | 0.97–1.07 | 10/10 exact; schedule and film APIs. The ten IDs were selected from the browser sample, so this checks those rows, not independent discovery or completeness. |
| Cinema City showtimes | 12.8–15.5 | Unavailable | Ten browser rows; initial HTML contained film details but no showtime options or tested ticket ID. No complete API route established. |
| Jaffa Cinematheque | 3.1–3.3 | 1.68–1.83 | 15/15 exact, full snapshot; page HTML |
| Herzliya Cinematheque | 34.7–35.9 | 16.68–17.30 | 10/10 exact; listing and film HTML |
| Haifa Cinematheque | 24.0–24.1 | 8.40–8.51 | 10/10 exact; initial listing and event HTML |
| Jerusalem Cinematheque | 5.1; repeat failed | 0.54–0.59 | One calendar day: 5 exact browser rows and one extra requests row. The repeat browser run failed with a stale element. Not an exact match. |
| Tel Aviv Cinematheque | 2.9–5.8 | 0.19–0.23 | 10/10 exact; date-page HTML |
| Lev coming soon | 19.4–21.1 | 8.78–9.28 | 10/10 exact; bilingual film HTML |
| Yes Planet coming soon | 8.6–9.9 | 2.47–2.70 | 10/10 exact; feed and film APIs |
| Cinema City coming soon | 3.7–9.7 | 1.52–2.32 | 10/10 exact on the first listing page; page and film HTML. Load-more was deliberately skipped in this focused check; the unmodified load-more attempt timed out. |
| Hot Cinema coming soon | 9.0–10.0 | 1.21–1.34 | 10/10 exact in paired snapshots; page and film HTML. A later browser sample differed from the earlier requests sample in one film's age rating; a fresh request matched it. |
| MovieLand coming soon | 23.3–23.9 | 6.27–6.55 | 48/48 exact, full snapshot; page and film HTML |

Jaffa and MovieLand coming-soon were previously converted to requests in the working tree; their browser baselines were loaded from the committed versions. The other request prototypes are experiments, not production replacements. Ten matching rows do not establish full catalog coverage or future parity. In particular, the earlier full Hot Cinema and Yes Planet investigations found output discrepancies, so today's matching focused rows do not resolve those full-scrape issues. Cinema City's full coming-soon pagination and showtime data still need separate solutions. The scraping jobs run in parallel; these individual timings cannot be summed or used to claim an overall pipeline speedup.
