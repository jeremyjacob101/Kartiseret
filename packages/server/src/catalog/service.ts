import type { Movie } from "@kartiseret/contracts/movies";
import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import { isPendingSoloUpdate, toNowPlayingMovie } from "./movie-mapper.js";
import { orderNowPlayingRows } from "./now-playing-ranking.js";

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

  const orderedRows = orderNowPlayingRows(visibleRows).map((row) => ({
    row,
    tmdbId: tmdbIdSchema.parse(readField(row, "tmdbId")),
  }));

  return orderedRows.map(({ row, tmdbId }) =>
    toNowPlayingMovie(row, movieCodes.get(tmdbId)),
  );
}

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
