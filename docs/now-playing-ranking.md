# Now-playing ranking

Both now-playing API implementations rank the visible catalog with the same
scorer. Coming-soon ordering and public movie fields are unchanged.

## Signals and weights

Popularity and total upcoming showtimes each use a 0–1 percentile within the
visible catalog. Ties share the average of their occupied ranks. Release
proximity is a separate 0–1 signal based on the calendar-day distance from the
local release date to today in Israel. The overall score is:

```text
showtimes = percentile(total upcoming regular-cinema screenings)
release proximity = 1 / (1 + exp((days from release − 17) / 5))

score = (percentile(popularity) + showtimes + release proximity) / 3
```

Release proximity uses the absolute day distance, so a release tomorrow scores
slightly higher than one in two days, which scores slightly higher than one in
three days. For example, the scores at 1, 2, and 3 days away are 0.961, 0.953,
and 0.943; at 7 and 14 days they are 0.881 and 0.646. A release 52 days away
scores about 0.001. Missing or invalid dates score zero. The scorer scales this
signal to integer precision when combining it with integer midrank numerators;
final ties use ascending numeric TMDb ID.

Popularity, upcoming showtime count, and release-date proximity each contribute
one third of the overall score.

## Calendar and eligibility

- Use the calendar date in `Asia/Jerusalem`, starting at midnight. This ranking
  deliberately uses calendar dates, rather than the show's cinema-day grace
  period used for browsing screening times.
- Count `finalShowtimes` rows dated today or later as one showtime signal.
- Count regular-cinema rows across all cities. Exclude past and undated rows;
  `finalTheques` screenings are not included. Missing screening counts are zero.
- Release proximity is highest on the local release date and falls smoothly as
  the date moves into the past or future. Upcoming dates can therefore gain
  recency gradually as opening approaches, while dates months away receive much
  less credit than imminent releases.
- Null popularity ranks below numeric popularity, including zero. Release year
  is never used as a replacement for the local release date.
- Remove pending `solo_update` movies before calculating any percentiles.

The database query returns its statement's Israel date with the showtime count.
Recency uses that same date even when the request spans local midnight.
In-memory fixtures without this metadata use the scorer's supplied instant,
which defaults to the current instant.

## Storage and rollout

This change uses the existing date/TMDb showtime index and `movie_release_dates`
history table. It needs no migration or stored-date rewrite. Deploy the server
code through the standard PR checks. A rollback restores the previous scorer
and query without changing any published data.

The Early tickets spotlight is a separate future feature. It does not affect
the score described here.
