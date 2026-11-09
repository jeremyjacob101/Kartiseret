import type { Movie, ShowtimeEntry, TheaterShowtimes } from "./movieCatalog";
import type { PublicShowtime } from "@kartiseret/contracts/public-data";

export type CinemathequeShowtimesDay = {
  date: string;
  movies: Array<{
    movie: Movie;
    theaters: readonly TheaterShowtimes[];
  }>;
};

const OTHER_CINEMATHEQUE_NAMES = ["jaffa cinema", "sam spiegel cinema"];

export function isCinemathequeTheaterName(theater: string): boolean {
  const normalized = theater.trim().toLocaleLowerCase();

  return (
    normalized.includes("cinematheque") ||
    normalized.includes("cinemateque") ||
    OTHER_CINEMATHEQUE_NAMES.some((name) => normalized.includes(name))
  );
}

export function buildCinemathequeShowtimesByDate(
  movies: readonly Movie[],
  showtimes: readonly PublicShowtime[],
  dates: readonly string[],
): CinemathequeShowtimesDay[] {
  const movieById = new Map(movies.map((movie) => [movie.tmdbId, movie]));
  const showtimesByDateAndMovie = new Map<
    string,
    Map<string, Map<string, ShowtimeEntry[]>>
  >();

  for (const showtime of showtimes) {
    if (!isCinemathequeTheaterName(showtime.cinema)) {
      continue;
    }
    const movie = movieById.get(showtime.tmdbId);
    if (!movie) {
      continue;
    }

    let moviesOnDate = showtimesByDateAndMovie.get(showtime.dateOfShowing);
    if (!moviesOnDate) {
      moviesOnDate = new Map();
      showtimesByDateAndMovie.set(showtime.dateOfShowing, moviesOnDate);
    }
    let theaters = moviesOnDate.get(showtime.tmdbId);
    if (!theaters) {
      theaters = new Map();
      moviesOnDate.set(showtime.tmdbId, theaters);
    }
    let entries = theaters.get(showtime.cinema);
    if (!entries) {
      entries = [];
      theaters.set(showtime.cinema, entries);
    }
    entries.push({
      time: showtime.showtime,
      href: showtime.englishHref ?? showtime.hebrewHref,
      screeningTech: showtime.screeningTech,
      screeningType: showtime.screeningType,
      dubLanguage: showtime.dubLanguage,
    });
  }

  return dates.map((date) => ({
    date,
    movies: movies.flatMap((movie) => {
      const theaters = showtimesByDateAndMovie.get(date)?.get(movie.tmdbId);
      if (!theaters) {
        return [];
      }
      return [
        {
          movie,
          theaters: [...theaters.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([theater, entries]) => ({
              theater,
              showtimes: entries.sort(
                (left, right) =>
                  left.time.localeCompare(right.time) ||
                  left.screeningTech.localeCompare(right.screeningTech) ||
                  left.screeningType.localeCompare(right.screeningType),
              ),
            })) satisfies TheaterShowtimes[],
        },
      ];
    }),
  }));
}

export function buildCinemathequeSchedule(
  movies: readonly Movie[],
  showtimes: readonly PublicShowtime[],
): Array<{
  date: string;
  cinemas: Array<{
    cinema: string;
    movies: CinemathequeShowtimesDay["movies"];
  }>;
}> {
  const dates = [
    ...new Set(showtimes.map((showtime) => showtime.dateOfShowing)),
  ].sort();
  return buildCinemathequeShowtimesByDate(movies, showtimes, dates).flatMap((
    day,
  ) => {
    const cinemas = new Map<string, CinemathequeShowtimesDay["movies"]>();
    for (const { movie, theaters } of day.movies) {
      for (const theater of theaters) {
        const entries = cinemas.get(theater.theater) ?? [];
        entries.push({ movie, theaters: [theater] });
        cinemas.set(theater.theater, entries);
      }
    }
    return cinemas.size
      ? [
          {
            date: day.date,
            cinemas: [...cinemas.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([cinema, cinemaMovies]) => ({
                cinema,
                movies: cinemaMovies.sort(
                  (left, right) =>
                    (left.theaters[0]?.showtimes[0]?.time ?? "").localeCompare(
                      right.theaters[0]?.showtimes[0]?.time ?? "",
                    ) || left.movie.title.localeCompare(right.movie.title),
                ),
              })),
          },
        ]
      : [];
  });
}

export function buildFocusedCinemathequeSchedule(
  movies: readonly Movie[],
  showtimes: readonly PublicShowtime[],
  tmdbId: string,
  city?: string,
): Array<{
  date: string;
  venues: Array<{
    city: string;
    cinema: string;
    showtimes: ShowtimeEntry[];
  }>;
}> {
  const movie = movies.find((candidate) => candidate.tmdbId === tmdbId);
  if (!movie) return [];

  const dates = new Map<
    string,
    Map<string, { city: string; cinema: string; showtimes: ShowtimeEntry[] }>
  >();
  for (const showtime of showtimes) {
    if (
      showtime.tmdbId !== tmdbId ||
      !isCinemathequeTheaterName(showtime.cinema) ||
      (city !== undefined && showtime.screeningCity !== city)
    ) {
      continue;
    }
    const venues = dates.get(showtime.dateOfShowing) ?? new Map();
    const key = `${showtime.screeningCity}\u001f${showtime.cinema}`;
    const venue = venues.get(key) ?? {
      city: showtime.screeningCity,
      cinema: showtime.cinema,
      showtimes: [],
    };
    venue.showtimes.push({
      time: showtime.showtime,
      href: showtime.englishHref ?? showtime.hebrewHref,
      screeningTech: showtime.screeningTech,
      screeningType: showtime.screeningType,
      dubLanguage: showtime.dubLanguage,
    });
    venues.set(key, venue);
    dates.set(showtime.dateOfShowing, venues);
  }

  return [...dates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, venues]) => ({
      date,
      venues: [...venues.values()]
        .map((venue) => ({
          ...venue,
          showtimes: venue.showtimes.sort((left, right) =>
            left.time.localeCompare(right.time)),
        }))
        .sort(
          (left, right) =>
            left.city.localeCompare(right.city) ||
            left.cinema.localeCompare(right.cinema),
        ),
    }));
}
