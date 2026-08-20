import { z } from "zod";
import { isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, tmdbIdSchema } from "../validation/runtime.js";

const nullableTextSchema = z.string().nullable();
const nullableNumberishSchema = z.union([
  z.number().finite(),
  z.string(),
  z.null(),
]);
const nullableBooleanishSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.null(),
]);
const genresValueSchema = z.union([z.array(z.string()), z.string(), z.null()]);

export const movieAltOptionInputSchema = z
  .object({
    tmdb: z.union([z.string(), z.number().finite()]),
    title: z.string(),
    year: nullableNumberishSchema.optional(),
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
    tmdb_id: z.union([z.string(), z.number().finite()]),
    english_title: z.string(),
    release_year: nullableNumberishSchema,
    release_date: nullableTextSchema.optional(),
    solo_update: nullableBooleanishSchema,
    genres: genresValueSchema,
    en_poster: nullableTextSchema,
    alt_options: z.array(movieAltOptionInputSchema).nullable(),
    en_trailer: nullableTextSchema,
    backdrop: nullableTextSchema,
    imdbRating: nullableNumberishSchema,
    rtCriticRating: nullableNumberishSchema,
    rtAudienceRating: nullableNumberishSchema,
    runtime: nullableNumberishSchema,
    popularity: nullableNumberishSchema,
    ...optionalMovieColumns,
  })
  .passthrough();

export const comingSoonMovieRowSchema = z
  .object({
    tmdb_id: z.union([z.string(), z.number().finite()]),
    english_title: z.string(),
    release_year: nullableNumberishSchema,
    release_date: isoDateStringSchema,
    solo_update: nullableBooleanishSchema,
    genres: genresValueSchema,
    en_poster: nullableTextSchema,
    alt_options: z.array(movieAltOptionInputSchema).nullable(),
    backdrop: nullableTextSchema,
    en_trailer: nullableTextSchema,
    imdbRating: nullableNumberishSchema.optional().default(null),
    rtCriticRating: nullableNumberishSchema.optional().default(null),
    rtAudienceRating: nullableNumberishSchema.optional().default(null),
    runtime: nullableNumberishSchema.optional(),
    popularity: nullableNumberishSchema.optional(),
    ...optionalMovieColumns,
  })
  .passthrough();

export const movieCodeRowSchema = z
  .object({
    tmdb_id: z.union([z.string(), z.number().finite()]),
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
    tmdb_id: z.union([z.string(), z.number().finite()]),
    screening_city: nonEmptyTrimmedStringSchema,
    date_of_showing: isoDateStringSchema,
    cinema: nonEmptyTrimmedStringSchema,
    showtime: z
      .string()
      .trim()
      .regex(/^(?:[01]?\d|2[0-3]):[0-5]\d/, "Expected a valid showtime."),
    english_href: nullableTextSchema,
    screening_tech: optionalShowtimeTextSchema,
    screening_type: optionalShowtimeTextSchema,
    dub_language: optionalShowtimeTextSchema,
  })
  .passthrough();

export const existingMovieTargetRowSchema = z
  .object({
    tmdb_id: z.union([z.string(), z.number().finite()]),
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

export const citySchema = z.object({
  name: nonEmptyTrimmedStringSchema,
  altSpellings: z.array(nonEmptyTrimmedStringSchema),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  zoomLayer: z.number().finite().min(0).max(24),
  neighboringCities: z.array(nonEmptyTrimmedStringSchema),
});

export const theaterSchema = z.object({
  city: citySchema,
  chain: z.string(),
  address: z.string(),
  theaterName: z.string(),
  location: z.string(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const movieAltOptionSchema = z.object({
  tmdbId: tmdbIdSchema,
  title: nonEmptyTrimmedStringSchema,
  year: z.number().int().nonnegative().nullable(),
  posterUrl: z.string().nullable(),
});

export const movieSchema = z.object({
  tmdbId: tmdbIdSchema,
  movieCode: movieCodeSchema.optional(),
  imdbId: z.string().min(1).optional(),
  rtId: z.string().min(1).optional(),
  title: nonEmptyTrimmedStringSchema,
  year: z.number().int().nonnegative(),
  releaseDate: isoDateStringSchema.optional(),
  genres: z.array(nonEmptyTrimmedStringSchema),
  imageSrc: z.string(),
  backdropSrc: z.string().optional(),
  trailerKey: z.string().min(1).optional(),
  imdbRating: z.number().finite().nullable(),
  lbId: z.string().min(1).optional(),
  lbRating: z.number().finite().nullable(),
  lbVotes: z.number().finite().nullable(),
  tmdbRating: z.number().finite().nullable(),
  tmdbVotes: z.number().finite().nullable(),
  rtCriticRating: z.number().finite().nullable(),
  rtCriticVotes: z.number().finite().nullable(),
  rtAudienceRating: z.number().finite().nullable(),
  rtAudienceVotes: z.number().finite().nullable(),
  runtime: z.number().int().nonnegative(),
  popularity: z.number().finite(),
  altOptions: z.array(movieAltOptionSchema).max(10),
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
export type City = z.infer<typeof citySchema>;
export type Theater = z.infer<typeof theaterSchema>;
export type Movie = z.infer<typeof movieSchema>;
export type MovieAltOption = z.infer<typeof movieAltOptionSchema>;
export type AdminMovieEditPayload = z.input<typeof adminMovieEditPayloadSchema>;
