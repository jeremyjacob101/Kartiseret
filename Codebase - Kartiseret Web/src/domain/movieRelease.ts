import { isMovieReRelease, type Movie } from "@kartiseret/contracts/movies";

export type MovieReleaseCategory = "newReleases" | "reReleases";

export const MOVIE_RELEASE_CATEGORY_LABELS: Record<
  MovieReleaseCategory,
  string
> = {
  newReleases: "New Releases",
  reReleases: "Re-Releases",
};

export function getMovieReleaseCategory(
  movie: Pick<Movie, "year">,
  currentYear = new Date().getFullYear(),
): MovieReleaseCategory {
  return isMovieReRelease(movie.year, currentYear)
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
