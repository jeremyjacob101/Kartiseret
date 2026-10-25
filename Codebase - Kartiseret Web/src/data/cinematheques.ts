import { selectBroadMovieShowtimeDays, type Movie, type ShowtimeCityData, type TheaterShowtimes } from "./movieCatalog";

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
  cityData: ShowtimeCityData | undefined,
): CinemathequeShowtimesDay[] {
  if (movies.length === 0) {
    return [];
  }

  const showtimeDaysByMovie = new Map(
    movies.map((movie) => [
      movie.tmdbId,
      selectBroadMovieShowtimeDays(cityData, movie.tmdbId),
    ]),
  );
  const referenceDays = showtimeDaysByMovie.get(movies[0]!.tmdbId) ?? [];

  return referenceDays.map(({ date }) => ({
    date,
    movies: movies.flatMap((movie) => {
      const day = showtimeDaysByMovie
        .get(movie.tmdbId)
        ?.find((candidate) => candidate.date === date);
      const theaters = day?.theaters.filter((theater) =>
        isCinemathequeTheaterName(theater.theater));

      return theaters && theaters.length > 0 ? [{ movie, theaters }] : [];
    }),
  }));
}
