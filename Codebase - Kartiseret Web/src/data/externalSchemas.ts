import { z } from "zod";
import { isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, showtimeStringSchema, tmdbIdSchema } from "../validation/runtime.js";

const nullableTextSchema = z.string().nullable();
const nullableNumberishSchema = z.union([
  z.number().finite(),
  z.string(),
  z.null(),
]);
const nonnegativeNumberishSchema = nullableNumberishSchema.refine((value) => {
  const parsedValue = Number.parseInt(String(value ?? ""), 10);
  return !Number.isFinite(parsedValue) || parsedValue >= 0;
}, "Expected a non-negative numeric value.");
const nullableBooleanishSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.null(),
]);
const genresValueSchema = z.union([z.array(z.string()), z.string(), z.null()]);
const isNonEmptyMovieTitle = (value: string) =>
  value
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim().length > 0;
const movieTitleInputSchema = z
  .string()
  .refine(isNonEmptyMovieTitle, "Expected a non-empty movie title.");
const optionalIsoDateInputSchema = z.union([
  isoDateStringSchema,
  z.literal(""),
  z.null(),
]);

function isPendingSoloUpdate(
  value: z.infer<typeof nullableBooleanishSchema>,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function requireCompletedMovieTitle(
  row: {
    english_title: string;
    solo_update: z.infer<typeof nullableBooleanishSchema>;
  },
  context: z.RefinementCtx,
): void {
  if (
    !isPendingSoloUpdate(row.solo_update) &&
    !isNonEmptyMovieTitle(row.english_title)
  ) {
    context.addIssue({
      code: "custom",
      message: "Expected a non-empty movie title.",
      path: ["english_title"],
    });
  }
}

export const movieAltOptionInputSchema = z
  .object({
    tmdb: tmdbIdSchema,
    title: movieTitleInputSchema,
    year: nonnegativeNumberishSchema.optional(),
    poster_url: nullableTextSchema.optional(),
  })
  .passthrough();

const optionalMovieColumns = {
  imdb_id: nullableNumberishSchema.optional(),
  rt_id: nullableTextSchema.optional(),
  rtCriticVotes: nullableNumberishSchema.optional(),
  rtAudienceVotes: nullableNumberishSchema.optional(),
  lb_id: nullableTextSchema.optional(),
  lbRating: nullableNumberishSchema.optional(),
  lbVotes: nullableNumberishSchema.optional(),
  tmdbRating: nullableNumberishSchema.optional(),
  tmdbVotes: nullableNumberishSchema.optional(),
};

export const movieRowSchema = z
  .object({
    tmdb_id: tmdbIdSchema,
    english_title: z.string(),
    release_year: nonnegativeNumberishSchema,
    release_date: optionalIsoDateInputSchema.optional(),
    solo_update: nullableBooleanishSchema,
    genres: genresValueSchema,
    en_poster: nullableTextSchema,
    alt_options: z.array(movieAltOptionInputSchema).nullable(),
    en_trailer: nullableTextSchema,
    backdrop: nullableTextSchema,
    imdbRating: nullableNumberishSchema,
    rtCriticRating: nullableNumberishSchema,
    rtAudienceRating: nullableNumberishSchema,
    runtime: nonnegativeNumberishSchema,
    popularity: nullableNumberishSchema,
    ...optionalMovieColumns,
  })
  .passthrough()
  .superRefine(requireCompletedMovieTitle);

export const comingSoonMovieRowSchema = z
  .object({
    tmdb_id: tmdbIdSchema,
    english_title: z.string(),
    release_year: nonnegativeNumberishSchema,
    release_date: optionalIsoDateInputSchema,
    solo_update: nullableBooleanishSchema,
    genres: genresValueSchema,
    en_poster: nullableTextSchema,
    alt_options: z.array(movieAltOptionInputSchema).nullable(),
    backdrop: nullableTextSchema,
    en_trailer: nullableTextSchema,
    imdbRating: nullableNumberishSchema.optional().default(null),
    rtCriticRating: nullableNumberishSchema.optional().default(null),
    rtAudienceRating: nullableNumberishSchema.optional().default(null),
    runtime: nonnegativeNumberishSchema.optional(),
    popularity: nullableNumberishSchema.optional(),
    ...optionalMovieColumns,
  })
  .passthrough()
  .superRefine((row, context) => {
    requireCompletedMovieTitle(row, context);

    if (!isPendingSoloUpdate(row.solo_update) && !row.release_date) {
      context.addIssue({
        code: "custom",
        message: "Expected a release date for a completed coming-soon movie.",
        path: ["release_date"],
      });
    }
  });

export const movieCodeRowSchema = z
  .object({
    tmdb_id: tmdbIdSchema,
    movie_code: movieCodeSchema,
  })
  .passthrough();

const optionalShowtimeTextSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? "");

export const showtimeRowSchema = z
  .object({
    tmdb_id: tmdbIdSchema,
    screening_city: nonEmptyTrimmedStringSchema,
    date_of_showing: isoDateStringSchema,
    cinema: nonEmptyTrimmedStringSchema,
    showtime: showtimeStringSchema,
    english_href: nullableTextSchema,
    screening_tech: optionalShowtimeTextSchema,
    screening_type: optionalShowtimeTextSchema,
    dub_language: optionalShowtimeTextSchema,
  })
  .passthrough();

export const existingMovieTargetRowSchema = z
  .object({
    tmdb_id: tmdbIdSchema,
    english_title: z.string().nullable(),
  })
  .passthrough();

export const cityRowSchema = z.object({
  name: nonEmptyTrimmedStringSchema,
  alt_spellings: z.array(z.string()),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  zoom_layer: z.number().finite().min(0).max(24),
  neighboring_cities: z.array(z.string()),
});

export const theaterRowSchema = z.object({
  chain: z.string(),
  address: z.string(),
  location: z.string(),
  theater_name: z.string(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  city_details: cityRowSchema,
});

export const adminMovieEditPayloadSchema = z.object({
  mode: z.enum(["nowPlaying", "comingSoon"]),
  currentTmdbId: tmdbIdSchema,
  selectedTmdbId: tmdbIdSchema,
  selectedTitle: z.string().nullable().optional(),
  selectedYear: z.number().int().positive().nullable().optional(),
  selectedPosterUrl: z.string().nullable().optional(),
  isManualEntry: z.boolean(),
});

export type MovieRow = z.infer<typeof movieRowSchema>;
export type ComingSoonMovieRow = z.infer<typeof comingSoonMovieRowSchema>;
export type MovieCodeRow = z.infer<typeof movieCodeRowSchema>;
export type ShowtimeRow = z.infer<typeof showtimeRowSchema>;
export type TheaterRow = z.infer<typeof theaterRowSchema>;
export type AdminMovieEditPayload = z.input<typeof adminMovieEditPayloadSchema>;
