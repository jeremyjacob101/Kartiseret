# Now-playing ranking

Both now-playing API implementations rank the visible catalog with the same
scorer. Coming-soon ordering and public movie fields are unchanged.

## Signals and weights

For each signal, compute a 0–1 percentile within the visible catalog. Ties share
the average of their occupied ranks. The overall score is:

```text
showtimes = percentile(total upcoming regular-cinema screenings)

score = (percentile(popularity) + showtimes + percentile(release-date recency)) / 3
```

The scorer uses integer midrank numerators with equal weights. This
preserves the exact ordering of the formula without floating point errors when
final scores tie. Final ties use ascending numeric TMDb ID.

Popularity, upcoming showtime count, and release-date proximity each contribute
one third of the overall score.

## Calendar and eligibility

- Use the calendar date in `Asia/Jerusalem`, starting at midnight. This ranking
  deliberately uses calendar dates, rather than the show's cinema-day grace
  period used for browsing screening times.
- Count `finalShowtimes` rows dated today or later as one showtime signal.
- Count regular-cinema rows across all cities. Exclude past and undated rows;
  `finalTheques` screenings are not included. Missing screening counts are zero.
- Give valid local release dates within 14 days before or after today's Israel
  date the highest recency ranks, with dates closer to today ranking higher.
  Released dates older than 14 days rank newest first. Dates more than 14 days
  in the future share the lowest rank with missing or invalid dates, so a film
  months from release does not gain recency credit early.
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
