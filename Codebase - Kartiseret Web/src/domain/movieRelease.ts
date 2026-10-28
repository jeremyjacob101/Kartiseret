import type { Movie } from "../data/movieCatalog";

export type MovieReleaseCategory = "newReleases" | "reReleases";

export const MOVIE_RELEASE_CATEGORY_LABELS: Record<
  MovieReleaseCategory,
  string
> = {
  newReleases: "New Releases",
  reReleases: "Re-Releases",
};

const RE_RELEASE_YEAR_OFFSET = 3;

export function getMovieReleaseCategory(
  movie: Pick<Movie, "year">,
  currentYear = new Date().getFullYear(),
): MovieReleaseCategory {
  return movie.year > 0 && movie.year <= currentYear - RE_RELEASE_YEAR_OFFSET
    ? "reReleases"
    : "newReleases";
}

export function filterMoviesByReleaseCategory<T extends Pick<Movie, "year">>(
  movies: readonly T[],
  category: MovieReleaseCategory,
  currentYear = new Date().getFullYear(),
): T[] {
  return movies.filter(
    (movie) => getMovieReleaseCategory(movie, currentYear) === category,
  );
}
