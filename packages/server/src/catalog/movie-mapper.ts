import {
  movieAltOptionSchema,
  movieSchema,
  type Movie,
} from "@kartiseret/contracts/movies";
import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import { z } from "zod";
import { CatalogDataIntegrityError } from "./errors.js";

const sourceMovieSchema = z.object({
  tmdbId: z.number().int().positive(),
  englishTitle: z.string(),
  releaseYear: z.union([z.bigint(), z.number().int()]).nullable(),
  genres: z.union([z.array(z.string()), z.null()]),
  enPoster: z.string().nullable(),
  backdrop: z.string().nullable(),
  enTrailer: z.string().nullable(),
  imdbId: z.string().nullable(),
  rtId: z.string().nullable(),
  imdbRating: z.union([z.number(), z.string(), z.null()]),
  imdbVotes: z.string().nullable(),
  rtAudienceRating: z.union([z.number(), z.string(), z.null()]),
  rtAudienceVotes: z.union([z.number(), z.string(), z.null()]),
  rtCriticRating: z.union([z.number(), z.string(), z.null()]),
  rtCriticVotes: z.union([z.number(), z.string(), z.null()]),
  lbId: z.string().nullable(),
  lbRating: z.union([z.number(), z.string(), z.null()]),
  lbVotes: z.union([z.number(), z.string(), z.null()]),
  tmdbRating: z.union([z.number(), z.string(), z.null()]),
  tmdbVotes: z.union([z.number(), z.string(), z.null()]),
  runtime: z.union([z.number(), z.null()]),
  popularity: z.union([z.number(), z.null()]),
  altOptions: z.unknown(),
  soloUpdate: z.boolean(),
});

type SourceMovie = z.infer<typeof sourceMovieSchema>;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseOptionalNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: number | null, fallback = 0): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Math.trunc(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function parseReleaseYear(value: bigint | number | null): number {
  if (value === null) {
    return 0;
  }

  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CatalogDataIntegrityError(
        "A movie release year is outside the JSON-safe integer range.",
      );
    }
    return Number(value);
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CatalogDataIntegrityError(
      "A movie release year is not a non-negative safe integer.",
    );
  }

  return value;
}

function parseGenres(value: string[] | null): string[] {
  if (value === null) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((genre) => normalizeText(genre.replace(/^"+|"+$/g, "")))
        .filter(Boolean),
    ),
  ];
}

function parseAlternatives(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CatalogDataIntegrityError(
      "A movie alternative list is not a JSON array.",
    );
  }

  return value
    .flatMap((entry) => {
      const result = z
        .object({
          tmdb: tmdbIdSchema,
          title: z.string().trim().min(1),
          year: z.union([z.number(), z.string(), z.null()]).optional(),
          poster_url: z.union([z.string(), z.null()]).optional(),
        })
        .safeParse(entry);

      if (!result.success) {
        return [];
      }

      const rawYear = result.data.year;
      const parsedYear =
        rawYear === undefined || rawYear === null
          ? null
          : Number.parseInt(String(rawYear), 10);

      const alt = movieAltOptionSchema.safeParse({
        tmdbId: result.data.tmdb,
        title: normalizeText(result.data.title),
        year:
          parsedYear !== null &&
          Number.isSafeInteger(parsedYear) &&
          parsedYear >= 0
            ? parsedYear
            : null,
        posterUrl: result.data.poster_url ?? null,
      });

      return alt.success ? [alt.data] : [];
    })
    .slice(0, 10);
}

function optionalId(value: string | null): string | undefined {
  const normalized = value?.trim() ?? "";
  return normalized || undefined;
}

function mapSourceMovie(row: SourceMovie, movieCode?: string): Movie {
  const title = normalizeText(row.englishTitle)
    .replace(/^"+|"+$/g, "")
    .trim();
  const imageSrc =
    normalizeText(row.enPoster ?? "") || normalizeText(row.backdrop ?? "");
  const backdropSrc = normalizeText(row.backdrop ?? "") || imageSrc;
  const trailerKey = normalizeText(row.enTrailer ?? "");

  return movieSchema.parse({
    tmdbId: String(row.tmdbId),
    movieCode,
    imdbId: optionalId(row.imdbId),
    rtId: optionalId(row.rtId),
    title,
    year: parseReleaseYear(row.releaseYear),
    genres: parseGenres(row.genres),
    imageSrc,
    backdropSrc: backdropSrc || undefined,
    trailerKey: trailerKey || undefined,
    imdbRating: parseOptionalNumber(row.imdbRating),
    lbId: optionalId(row.lbId),
    lbRating: parseOptionalNumber(row.lbRating),
    lbVotes: parseOptionalNumber(row.lbVotes),
    tmdbRating: parseOptionalNumber(row.tmdbRating),
    tmdbVotes: parseOptionalNumber(row.tmdbVotes),
    rtCriticRating: parseOptionalNumber(row.rtCriticRating),
    rtCriticVotes: parseOptionalNumber(row.rtCriticVotes),
    rtAudienceRating: parseOptionalNumber(row.rtAudienceRating),
    rtAudienceVotes: parseOptionalNumber(row.rtAudienceVotes),
    runtime: parseInteger(row.runtime),
    popularity: Number.isFinite(row.popularity) ? row.popularity : 0,
    altOptions: parseAlternatives(row.altOptions),
  });
}

export function toNowPlayingMovie(value: unknown, movieCode?: string): Movie {
  const parsed = sourceMovieSchema.safeParse(value);

  if (!parsed.success) {
    throw new CatalogDataIntegrityError(
      "A now-playing movie row does not match the expected database shape.",
      parsed.error,
    );
  }

  if (parsed.data.soloUpdate) {
    throw new CatalogDataIntegrityError(
      "A pending solo-update row reached the public catalog mapper.",
    );
  }

  try {
    return mapSourceMovie(parsed.data, movieCode);
  } catch (error) {
    if (error instanceof CatalogDataIntegrityError) {
      throw error;
    }
    throw new CatalogDataIntegrityError(
      "A now-playing movie row could not be normalized.",
      error,
    );
  }
}

export function isPendingSoloUpdate(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === "true" ||
    value === "t" ||
    value === "1"
  );
}
