import {
  movieAltOptionSchema,
  movieSchema,
  type Movie,
} from "@kartiseret/contracts/movies";
import { socialPreviewFingerprintSchema } from "@kartiseret/contracts/social-preview";
import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import { createSocialPreviewFingerprint } from "../social-preview.js";
import { z } from "zod";
import { CatalogDataIntegrityError } from "./errors.js";

const sourceMovieSchema = z.object({
  tmdbId: z.number().int().positive(),
  englishTitle: z.string(),
  releaseYear: z.union([z.bigint(), z.number().int()]).nullable(),
  genres: z.union([z.array(z.string()), z.null()]),
  enPoster: z.string().nullable(),
  backdrop: z.string().nullable(),
  socialPreviewFingerprint: z.string().nullable().optional(),
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

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function currentPreviewFingerprint(
  storedValue: string | null | undefined,
  data: Record<string, unknown>,
): string | undefined {
  const stored = socialPreviewFingerprintSchema.safeParse(storedValue);
  if (!stored.success) return undefined;
  try {
    return stored.data === createSocialPreviewFingerprint(data)
      ? stored.data
      : undefined;
  } catch {
    return undefined;
  }
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

function artworkSrcSet(value: string | null | undefined): string | undefined {
  const match =
    /^(https?:\/\/[^/]+)?\/api\/images\/v1\/(poster|backdrop)\/([a-f0-9]{64})\/(\d+)\.webp$/.exec(
      value?.trim() ?? "",
    );
  if (!match) return undefined;
  const [, , kind, hash] = match;
  const widths = kind === "poster" ? [185, 342, 780] : [780, 1280];
  return widths
    .map((width) => `/api/images/v1/${kind}/${hash}/${width}.webp ${width}w`)
    .join(", ");
}

function mapSourceMovie(row: SourceMovie, movieCode?: string): Movie {
  const title = normalizeText(row.englishTitle)
    .replace(/^"+|"+$/g, "")
    .trim();
  const imageSrc =
    normalizeText(row.enPoster ?? "") || normalizeText(row.backdrop ?? "");
  const backdropSrc = normalizeText(row.backdrop ?? "") || imageSrc;
  const imageSrcSet = artworkSrcSet(row.enPoster);
  const backdropSrcSet = artworkSrcSet(row.backdrop);
  const trailerKey = normalizeText(row.enTrailer ?? "");
  const genres = parseGenres(row.genres);
  const year = parseReleaseYear(row.releaseYear);
  const runtime = parseInteger(row.runtime);
  const socialPreviewFingerprint = currentPreviewFingerprint(
    row.socialPreviewFingerprint,
    {
      tmdbId: String(row.tmdbId),
      title,
      posterUrl: imageSrc,
      backdropUrl: backdropSrc,
      isComingSoon: false,
      year: year > 0 ? year : null,
      releaseDate: null,
      runtime: runtime > 0 ? runtime : null,
      genres: genres.slice(0, 3),
      imdbRating: positiveOrNull(parseOptionalNumber(row.imdbRating)),
      rtCriticRating: positiveOrNull(parseOptionalNumber(row.rtCriticRating)),
      rtCriticVotes: positiveOrNull(parseOptionalNumber(row.rtCriticVotes)),
      rtAudienceRating: positiveOrNull(
        parseOptionalNumber(row.rtAudienceRating),
      ),
      rtAudienceVotes: positiveOrNull(parseOptionalNumber(row.rtAudienceVotes)),
      lbRating: positiveOrNull(parseOptionalNumber(row.lbRating)),
    },
  );

  return movieSchema.parse({
    tmdbId: String(row.tmdbId),
    movieCode,
    imdbId: optionalId(row.imdbId),
    rtId: optionalId(row.rtId),
    title,
    year,
    genres,
    imageSrc,
    ...(imageSrcSet ? { imageSrcSet } : {}),
    backdropSrc: backdropSrc || undefined,
    ...(backdropSrcSet ? { backdropSrcSet } : {}),
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
    runtime,
    ...(socialPreviewFingerprint ? { socialPreviewFingerprint } : {}),
    popularity: Number.isFinite(row.popularity) ? row.popularity : 0,
    altOptions: parseAlternatives(row.altOptions),
  });
}

const sourceComingSoonMovieSchema = z.object({
  tmdbId: z.number().int().positive(),
  englishTitle: z.string(),
  releaseYear: z.number().int().nullable(),
  releaseDate: z.string(),
  genres: z.union([z.array(z.string()), z.null()]),
  enPoster: z.string().nullable(),
  backdrop: z.string().nullable(),
  socialPreviewFingerprint: z.string().nullable().optional(),
  enTrailer: z.string().nullable(),
  runtime: z.number().nullable(),
  popularity: z.number().nullable(),
  altOptions: z.unknown(),
  soloUpdate: z.boolean(),
});

function parseComingSoonAlternatives(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CatalogDataIntegrityError(
      "A coming-soon movie alternative list is not a JSON array.",
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

      const parsedYear =
        result.data.year === undefined || result.data.year === null
          ? null
          : Number.parseInt(String(result.data.year), 10);
      const alternative = movieAltOptionSchema.safeParse({
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

      return alternative.success ? [alternative.data] : [];
    })
    .slice(0, 10);
}

function mapSourceComingSoonMovie(
  row: z.infer<typeof sourceComingSoonMovieSchema>,
  movieCode?: string,
): Movie {
  const title = normalizeText(row.englishTitle)
    .replace(/^"+|"+$/g, "")
    .trim();
  const imageSrc =
    normalizeText(row.enPoster ?? "") || normalizeText(row.backdrop ?? "");
  const backdropSrc = normalizeText(row.backdrop ?? "") || imageSrc;
  const imageSrcSet = artworkSrcSet(row.enPoster);
  const backdropSrcSet = artworkSrcSet(row.backdrop);
  const parsedYear =
    row.releaseYear !== null && row.releaseYear > 0
      ? row.releaseYear
      : 0;
  const genres = parseGenres(row.genres);
  const runtime = parseInteger(row.runtime);
  const socialPreviewFingerprint = currentPreviewFingerprint(
    row.socialPreviewFingerprint,
    {
      tmdbId: String(row.tmdbId),
      title,
      posterUrl: imageSrc,
      backdropUrl: backdropSrc,
      isComingSoon: true,
      year:
        Number.isSafeInteger(parsedYear) && parsedYear > 0 ? parsedYear : null,
      releaseDate: row.releaseDate,
      runtime: runtime > 0 ? runtime : null,
      genres: genres.slice(0, 3),
      imdbRating: null,
      rtCriticRating: null,
      rtCriticVotes: null,
      rtAudienceRating: null,
      rtAudienceVotes: null,
      lbRating: null,
    },
  );

  return movieSchema.parse({
    tmdbId: String(row.tmdbId),
    movieCode,
    title,
    year: Number.isSafeInteger(parsedYear) && parsedYear > 0 ? parsedYear : 0,
    releaseDate: row.releaseDate,
    genres,
    imageSrc,
    ...(imageSrcSet ? { imageSrcSet } : {}),
    backdropSrc: backdropSrc || undefined,
    ...(backdropSrcSet ? { backdropSrcSet } : {}),
    trailerKey: normalizeText(row.enTrailer ?? "") || undefined,
    imdbRating: null,
    lbRating: null,
    lbVotes: null,
    tmdbRating: null,
    tmdbVotes: null,
    rtCriticRating: null,
    rtCriticVotes: null,
    rtAudienceRating: null,
    rtAudienceVotes: null,
    runtime,
    ...(socialPreviewFingerprint ? { socialPreviewFingerprint } : {}),
    popularity: Number.isFinite(row.popularity) ? row.popularity : 0,
    altOptions: parseComingSoonAlternatives(row.altOptions),
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

export function toComingSoonMovie(value: unknown, movieCode?: string): Movie {
  const parsed = sourceComingSoonMovieSchema.safeParse(value);

  if (!parsed.success) {
    throw new CatalogDataIntegrityError(
      "A coming-soon movie row does not match the expected database shape.",
      parsed.error,
    );
  }

  if (parsed.data.soloUpdate) {
    throw new CatalogDataIntegrityError(
      "A pending solo-update row reached the public catalog mapper.",
    );
  }

  try {
    return mapSourceComingSoonMovie(parsed.data, movieCode);
  } catch (error) {
    if (error instanceof CatalogDataIntegrityError) {
      throw error;
    }
    throw new CatalogDataIntegrityError(
      "A coming-soon movie row could not be normalized.",
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
