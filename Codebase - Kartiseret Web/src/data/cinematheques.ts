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
