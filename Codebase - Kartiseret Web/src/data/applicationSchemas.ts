import { z } from "zod";
import { isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, tmdbIdSchema } from "../validation/runtime.js";

/**
 * Application-model contracts are the source of inferred internal types and
 * fixture assertions. Runtime ingress parsing belongs in externalSchemas.ts.
 */
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

export type City = z.infer<typeof citySchema>;
export type Theater = z.infer<typeof theaterSchema>;
export type Movie = z.infer<typeof movieSchema>;
export type MovieAltOption = z.infer<typeof movieAltOptionSchema>;
