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

  const orderedRows = visibleRows
    .map((row, index) => ({ row, tmdbId: ids[index] ?? "" }))
    .sort(compareCatalogRows);

  return orderedRows.map(({ row, tmdbId }) =>
    toNowPlayingMovie(row, movieCodes.get(tmdbId)),
  );
}

function compareCatalogRows(
  left: { row: unknown; tmdbId: string },
  right: { row: unknown; tmdbId: string },
): number {
  const leftPopularity = readField(left.row, "popularity");
  const rightPopularity = readField(right.row, "popularity");
  const leftIsNull = leftPopularity === null || leftPopularity === undefined;
  const rightIsNull = rightPopularity === null || rightPopularity === undefined;

  if (leftIsNull !== rightIsNull) {
    return leftIsNull ? 1 : -1;
  }

  if (!leftIsNull && !rightIsNull) {
    const difference = Number(rightPopularity) - Number(leftPopularity);
    if (difference !== 0) {
      return difference;
    }
  }

  const leftId = BigInt(left.tmdbId);
  const rightId = BigInt(right.tmdbId);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}
