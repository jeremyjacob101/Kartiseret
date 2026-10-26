# Now-playing ranking

Both now-playing API implementations rank the visible catalog with the same
scorer. Coming-soon ordering and public movie fields are unchanged.

## Signals and weights

For each signal, compute a 0–1 percentile within the visible catalog. Ties share
the average of their occupied ranks. The overall score is:

```text
showtimes = 0.80 × percentile(near screenings)
          + 0.20 × percentile(distant screenings)

score = (percentile(popularity) + showtimes + percentile(released date)) / 3
```

The scorer uses integer midrank numerators with weights 10, 8, 2, and 10. This
preserves the exact ordering of the formula without floating point errors when
final scores tie. Final ties use ascending numeric TMDb ID.

The distant component can contribute at most 20% of the showtime signal, or
1/15 of the overall normalized score. Large advance schedules cannot increase
that cap. Popularity and release recency retain one third of the score each.

## Calendar and eligibility

- Use the calendar date in `Asia/Jerusalem`, starting at midnight. This ranking
  deliberately uses calendar dates, rather than the show's cinema-day grace
  period used for browsing screening times.
- Near screenings are rows in `finalShowtimes` dated today through today + 14
  days, including both endpoints. Distant screenings are dated day 15 or later.
- Count regular-cinema rows across all cities. Exclude past and undated rows;
  `finalTheques` screenings are not included. Missing screening counts are zero.
- Rank local release dates only after the date arrives. A date later than today
  shares the lowest rank with missing or invalid dates. Today's release gets
  normal recency credit, and newer released dates rank above older ones.
- Null popularity ranks below numeric popularity, including zero. Release year
  is never used as a replacement for the local release date.
- Remove pending `solo_update` movies before calculating any percentiles.

The database query returns its statement's Israel date with both screening
counts. Recency uses that same date even when the request spans local midnight.
In-memory fixtures without this metadata use the scorer's supplied instant,
which defaults to the current instant.

## Storage and rollout

This change uses the existing date/TMDb showtime index and `movie_release_dates`
history table. It needs no migration or stored-date rewrite. Deploy the server
code through the standard PR checks. A rollback restores the previous scorer
and query without changing any published data.

The Early tickets spotlight is a separate future feature. It does not affect
the score described here.
