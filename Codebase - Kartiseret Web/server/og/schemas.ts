import { z } from "zod";
import { isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, tmdbIdSchema } from "../../src/validation/runtime.js";

const nullableNumberishSchema = z.union([
  z.number().finite(),
  z.string(),
  z.null(),
]);

export const databaseMovieSchema = z.object({
  english_title: z.string().nullable(),
  en_poster: z.string().nullable(),
  backdrop: z.string().nullable(),
  release_year: nullableNumberishSchema,
  release_date: z.string().nullable().optional(),
  runtime: nullableNumberishSchema,
  genres: z.union([z.array(z.string()), z.string(), z.null()]),
  imdbRating: nullableNumberishSchema.optional().default(null),
  rtCriticRating: nullableNumberishSchema.optional().default(null),
  rtCriticVotes: nullableNumberishSchema.optional().default(null),
  rtAudienceRating: nullableNumberishSchema.optional().default(null),
  rtAudienceVotes: nullableNumberishSchema.optional().default(null),
  lbRating: nullableNumberishSchema.optional().default(null),
});

export const databaseShowtimeSchema = z.object({
  cinema: z.string().nullable(),
  showtime: z.string().nullable(),
  screening_tech: z.string().nullable(),
  screening_type: z.string().nullable(),
  dub_language: z.string().nullable(),
});

export const movieCodeLookupRowSchema = z.object({
  tmdb_id: z.union([z.string(), z.number().finite()]),
});

export const previewTheaterSchema = z.object({
  theater: nonEmptyTrimmedStringSchema,
  showtimes: z.array(nonEmptyTrimmedStringSchema).max(4),
});

export const previewDataSchema = z.object({
  routeCode: z.string().min(3).max(10),
  movieCode: movieCodeSchema,
  tmdbId: tmdbIdSchema,
  title: nonEmptyTrimmedStringSchema,
  city: nonEmptyTrimmedStringSchema,
  date: isoDateStringSchema,
  dateLabel: nonEmptyTrimmedStringSchema,
  posterUrl: z.string(),
  backdropUrl: z.string(),
  isComingSoon: z.boolean(),
  theaters: z.array(previewTheaterSchema).max(3),
  year: z.number().finite().positive().nullable(),
  releaseDate: isoDateStringSchema.nullable(),
  runtime: z.number().finite().positive().nullable(),
  genres: z.array(nonEmptyTrimmedStringSchema).max(3),
  imdbRating: z.number().finite().positive().nullable(),
  rtCriticRating: z.number().finite().positive().nullable(),
  rtCriticVotes: z.number().finite().positive().nullable(),
  rtAudienceRating: z.number().finite().positive().nullable(),
  rtAudienceVotes: z.number().finite().positive().nullable(),
  lbRating: z.number().finite().positive().nullable(),
});

export const previewRouteSelectionSchema = z.object({
  movieCode: movieCodeSchema,
  city: nonEmptyTrimmedStringSchema,
  date: isoDateStringSchema,
  filterMask: z.number().int().min(0),
});

export const ogRequestQuerySchema = z
  .object({
    routeCode: z.string().max(10).optional().default(""),
    home: z
      .string()
      .optional()
      .transform((value) => value === "1"),
  })
  .passthrough();

export type DatabaseMovie = z.infer<typeof databaseMovieSchema>;
export type DatabaseShowtime = z.infer<typeof databaseShowtimeSchema>;
export type PreviewTheater = z.infer<typeof previewTheaterSchema>;
export type PreviewData = z.infer<typeof previewDataSchema>;
export type PreviewRouteSelection = z.infer<typeof previewRouteSelectionSchema>;
