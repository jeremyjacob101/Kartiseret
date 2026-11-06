# Cinema title sources and fallback

Audit on 2026-10-28. The title fields below are observations, not a guarantee
that a cinema will always supply an English title. The ticket pages and film
catalogues can change.

- **Cinema City:** [Jaffa](https://www.cinema-city.co.il/movie/6450),
  [Matchmaking](https://www.cinema-city.co.il/movie/6555),
  [Clayface](https://www.cinema-city.co.il/movie/6462), and
  [Our Loves](https://www.cinema-city.co.il/movie/6553). `main h1` is the
  Hebrew display title; `#comp-mkb98jrw` is labelled original title. It was
  Hebrew for Jaffa and Our Loves, and English for Matchmaking and Clayface.
  The Wix dynamic-page response for Jaffa contained no Jaffa/Stories text.
  A current [English checkout](https://tickets.cinema-city.co.il/order/885230?lang=en)
  showed the Hebrew title; its `api/presentations/885230` response contained no
  Jaffa/Stories text. The checkout then reported a reCAPTCHA validation error,
  so no later checkout state was inspected.
- **Hot Cinema:** [Jaffa](https://hotcinema.co.il/movie/3740) and
  [Matchmaking](https://hotcinema.co.il/movie/3889/matchmaking-3). The movie
  details `h2` contains Hebrew for Jaffa and `Matchmaking 3` for Matchmaking.
  Jaffa's `tickets/movieevents` responses contain screenings rather than an
  English title. No separate English title was identified in the inspected page
  or those responses.
- **Lev Cinema:** [Hebrew Matchmaking page](https://www.lev.co.il/movies/%d7%91%d7%97%d7%95%d7%a8%d7%99%d7%9d-%d7%98%d7%95%d7%91%d7%99%d7%9d-3/)
  shows `#content .movie_title h1` in Hebrew and `h2` as `Matchmaking 3`;
  its [English page](https://www.lev.co.il/en/movies/%d7%91%d7%97%d7%95%d7%a8%d7%99%d7%9d-%d7%98%d7%95%d7%91%d7%99%d7%9d-3/)
  shows `Matchmaking 3` in `#content .movie_title h1`, the existing scraper
  source. A Jaffa page was not found in the Lev listing or search, so its
  language variants could not be verified.
- **MovieLand:** [Jaffa](https://movieland.co.il/movie/4937),
  [Matchmaking](https://movieland.co.il/movie/5048),
  [Our Loves](https://movieland.co.il/movie/5050), and
  [Clayface](https://movieland.co.il/movie/4904). The second `span` in
  `.bg-more-b` was empty for the first three and `Clayface` for the fourth;
  the other spans contained release date, cast and other metadata. The first
  span is the Hebrew title. The existing third-child selector and second
  span-of-type both select the English span on the inspected pages.
- **Rav Hen:** [Jaffa](https://www.rav-hen.co.il/films/jaffa-2/8263s2r)
  and [Matchmaking](https://www.rav-hen.co.il/films/matchmaking-3/8551s2r).
  The film-page `h1` is Hebrew for both, as is the first `#more-info dd`.
  Each page's `rh/data-api-service/v1/10104/films/byDistributorCode/{id}`
  response has Hebrew in both `filmDetails.name` and `originalName`. Adding
  `lang=en_gb` did not change the Matchmaking heading. The URL slug is not
  treated as a verified title.
- **Yes Planet:** [English listing](https://www.planetcinema.co.il/?lang=en_gb#/)
  provides `Jaffa 2` and `Matchmaking 3` on the film cards, and the
  [Jaffa page](https://www.planetcinema.co.il/films/jaffa-2/8263s2r) pairs
  `Jaffa 2` in `h1` with the Hebrew title in the first `#more-info dd`.

For the five other chains, scraping keeps a validated Latin/numeric title or
an empty value, never a Hebrew title masquerading as English. Cleaning uses a
Yes Planet title only when all valid Yes Planet rows with the exact Hebrew
name agree after normalizing the English title. The mapping is shared across
cinemas for now-playing and coming-soon rows. It also handles legacy Rav Hen
rows whose English field held the Hebrew name. It does not overwrite a valid
source title. Hebrew names without a match, conflicting matches and invalid
Yes Planet titles stay empty and uncleaned; the mapper marks the row unresolved
and leaves it eligible for retry rather than inventing a title. A genuinely
numeric title is retained, while a numeric remnant matching the stripped
Hebrew title is not used as evidence. This fallback depends on an available
Yes Planet row and exact Hebrew spelling; an absent or differently named film
will remain unresolved.

A replay of run 666's raw CSVs maps Cinema City, Hot Cinema, MovieLand and
Rav Hen Jaffa rows to `Jaffa 2`; MovieLand and Rav Hen Matchmaking rows to
`Matchmaking 3`; and Cinema City, MovieLand and Rav Hen Our Loves rows to
`our loves`. This is an offline replay of the title helper, not a production
pipeline run.
