import { createEmptyShowtimeCityData, mergeShowtimeCityData, movieCatalogQueryKeys, SHOWTIME_WINDOW_DAY_COUNT, showtimeRangeQueryOptions, type MovieCollectionData } from "./data/movieCatalog.js";
import { publicPageBootstrapSchema, type PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { cinemathequeQueryOptions, type CinemathequeData } from "./data/cinemathequeCatalog.js";
import { getCinemaDayDate, SHOWTIME_TIME_ZONE } from "@kartiseret/contracts/showtime-day";
import { addCalendarDays } from "@kartiseret/contracts/showtime-links";
import { theaterDataQueryOptions } from "./data/theaters.js";
import type { QueryClient } from "@tanstack/react-query";

export function parsePublicPageBootstrap(
  value: unknown,
): PublicPageBootstrap | null {
  const parsed = publicPageBootstrapSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asMovieCollectionData(
  data: PublicPageBootstrap["catalogs"]["nowPlaying"],
): MovieCollectionData {
  return {
    ...data,
    moviesByCode: Object.fromEntries(
      data.movies.flatMap((movie) =>
        movie.movieCode ? [[movie.movieCode, movie] as const] : []),
    ),
  };
}

export function seedPublicPageQueries(
  queryClient: QueryClient,
  bootstrap: PublicPageBootstrap,
): void {
  const updatedAt = new Date(bootstrap.renderedAt).getTime();
  const renderInstant = new Date(bootstrap.renderedAt);
  const renderedDate = getCinemaDayDate(renderInstant, SHOWTIME_TIME_ZONE);
  const nowPlaying = asMovieCollectionData(bootstrap.catalogs.nowPlaying);
  const comingSoon = asMovieCollectionData(bootstrap.catalogs.comingSoon);

  queryClient.setQueryData(
    movieCatalogQueryKeys.collection("nowPlaying"),
    nowPlaying,
    { updatedAt },
  );
  queryClient.setQueryData(
    movieCatalogQueryKeys.collection("comingSoon"),
    comingSoon,
    { updatedAt },
  );

  if (bootstrap.theaters) {
    queryClient.setQueryData(
      theaterDataQueryOptions().queryKey,
      bootstrap.theaters,
      { updatedAt },
    );
  }

  if (bootstrap.showtimeCity) {
    const { city, startDate, endDate, showtimes } = bootstrap.showtimeCity;
    const dates: string[] = [];
    for (
      let date: string | null = startDate;
      date !== null && date <= endDate;
    ) {
      dates.push(date);
      date = addCalendarDays(date, 1);
    }
    const data = mergeShowtimeCityData(createEmptyShowtimeCityData(city), {
      city,
      todayDate: renderedDate,
      renderInstant,
      dates,
      movies: [...nowPlaying.movies, ...comingSoon.movies],
      rows: showtimes,
      scope: "broad",
      publicationRevision: bootstrap.publicationRevision,
      visibleDayCount: dates.length,
    });
    queryClient.setQueryData(
      movieCatalogQueryKeys.showtimeCity(city, bootstrap.publicationRevision),
      data,
      { updatedAt },
    );
  }

  if (bootstrap.targetedMovieShowtimes) {
    const { city, date, tmdbId, showtimes } = bootstrap.targetedMovieShowtimes;
    const key = movieCatalogQueryKeys.showtimeCity(
      city,
      bootstrap.publicationRevision,
    );
    const current =
      queryClient.getQueryData<ReturnType<typeof createEmptyShowtimeCityData>>(
        key,
      ) ?? createEmptyShowtimeCityData(city);
    const data = mergeShowtimeCityData(current, {
      city,
      todayDate: renderedDate,
      renderInstant,
      dates: [date],
      movies: [...nowPlaying.movies, ...comingSoon.movies],
      rows: showtimes,
      scope: { tmdbId },
      publicationRevision: bootstrap.publicationRevision,
      // The server bootstrap contains only the requested day. It is not a
      // contiguous window from today, so do not count it as one loaded day.
      targetedLoadedDayCount: 0,
      visibleDayCount: SHOWTIME_WINDOW_DAY_COUNT,
    });
    queryClient.setQueryData(key, data, { updatedAt });
    queryClient.setQueryData(
      showtimeRangeQueryOptions({
        city,
        startDate: date,
        endDate: date,
        tmdbId,
        publicationRevision: bootstrap.publicationRevision,
      }).queryKey,
      showtimes,
      { updatedAt },
    );
  }

  if (bootstrap.cinematheques) {
    const { city, data } = bootstrap.cinematheques;
    queryClient.setQueryData<CinemathequeData>(
      cinemathequeQueryOptions(city, bootstrap.publicationRevision).queryKey,
      { ...data, publicationRevision: bootstrap.publicationRevision },
      { updatedAt },
    );
  }

  if (bootstrap.cinema) {
    queryClient.setQueryData(
      ["publicCinema", bootstrap.cinema.id],
      bootstrap.cinema,
      { updatedAt },
    );
  }
}
