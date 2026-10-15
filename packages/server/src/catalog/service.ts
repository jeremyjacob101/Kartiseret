import type { Movie } from "@kartiseret/contracts/movies";
import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import { isPendingSoloUpdate, toNowPlayingMovie } from "./movie-mapper.js";

export interface CatalogRepository {
  findNowPlayingRows(): Promise<readonly unknown[]>;
  findMovieCodes(
    tmdbIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

export async function getNowPlayingMovies(
  repository: CatalogRepository,
): Promise<Movie[]> {
  const rows = await repository.findNowPlayingRows();
  const visibleRows: unknown[] = [];

  for (const row of rows) {
    if (isPendingSoloUpdate(readField(row, "soloUpdate"))) {
      continue;
    }
    visibleRows.push(row);
  }

  const ids = visibleRows.map((row) =>
    tmdbIdSchema.parse(readField(row, "tmdbId")),
  );
  const movieCodes = await repository.findMovieCodes(ids);

  return visibleRows
    .map((row, index) =>
      toNowPlayingMovie(row, movieCodes.get(ids[index] ?? "")),
    )
    .sort(
      (left, right) =>
        right.popularity - left.popularity ||
        left.tmdbId.localeCompare(right.tmdbId),
    );
}

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
