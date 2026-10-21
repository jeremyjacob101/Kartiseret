import type { TmdbTitleSearchResult } from "@kartiseret/contracts/public-data";
import { tmdbTitleSearchDataSchema } from "@kartiseret/contracts/public-data";
import type { PublicDataRepository } from "./repository.js";

export interface TmdbMovieSearchHit {
  tmdbId: string;
  title: string;
  releaseYear: number | null;
  posterPath: string | null;
}

export type TmdbSearchProvider = (
  query: string,
) => Promise<readonly TmdbMovieSearchHit[]>;

export class TmdbSearchUnavailableError extends Error {
  constructor() {
    super("TMDb title search is unavailable.");
    this.name = "TmdbSearchUnavailableError";
  }
}

type FetchLike = typeof fetch;

function tmdbYear(releaseDate: unknown): number | null {
  if (typeof releaseDate !== "string") return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(releaseDate);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1870 && year <= 2200 ? year : null;
}

export function createTmdbSearchProvider(
  apiKey: string | undefined,
  fetcher: FetchLike = fetch,
): TmdbSearchProvider {
  const key = apiKey?.trim() ?? "";
  return async (query) => {
    if (!key) throw new TmdbSearchUnavailableError();

    const url = new URL("https://api.themoviedb.org/3/search/movie");
    url.searchParams.set("api_key", key);
    url.searchParams.set("query", query);
    url.searchParams.set("include_adult", "false");
    url.searchParams.set("language", "en-US");

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new TmdbSearchUnavailableError();
    }
    if (!response.ok) throw new TmdbSearchUnavailableError();

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TmdbSearchUnavailableError();
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("results" in payload) ||
      !Array.isArray(payload.results)
    ) {
      throw new TmdbSearchUnavailableError();
    }

    return payload.results.slice(0, 20).flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const row = value as Record<string, unknown>;
      const id = row.id;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const posterPath =
        typeof row.poster_path === "string" &&
        /^\/[A-Za-z0-9_./-]+$/.test(row.poster_path)
          ? row.poster_path
          : null;
      if (!Number.isSafeInteger(id) || Number(id) <= 0 || !title) return [];
      return [
        {
          tmdbId: String(id),
          title: title.slice(0, 200),
          releaseYear: tmdbYear(row.release_date),
          posterPath,
        },
      ];
    });
  };
}

export async function searchTmdbTitles(
  query: string,
  provider: TmdbSearchProvider,
  repository: PublicDataRepository,
): Promise<TmdbTitleSearchResult[]> {
  const hits = (await provider(query)).slice(0, 20);
  const localIds = hits
    .filter((hit) => Number(hit.tmdbId) <= 2_147_483_647)
    .map((hit) => hit.tmdbId);
  const localRows = repository.findComingSoonMoviesByIds
    ? await repository.findComingSoonMoviesByIds(localIds)
    : await Promise.all(
        localIds.map((id) => repository.findComingSoonMovieById(id)),
      );
  const localDates = new Map<string, string>();
  for (const row of localRows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const id = record.tmdbId ?? record.tmdb_id;
    const date = record.releaseDate ?? record.release_date;
    if (id !== undefined && typeof date === "string")
      localDates.set(String(id), date);
  }

  return tmdbTitleSearchDataSchema.parse({
    titles: hits.map((hit) => ({
      ...hit,
      comingSoonDate: localDates.get(hit.tmdbId) ?? null,
    })),
  }).titles;
}
