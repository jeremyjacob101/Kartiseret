import {
  movieCatalogDataSchema,
  publicCinemaPageDataSchema,
  publicCinemathequeDataSchema,
  publicShowtimeSchema,
  publicTheaterDataSchema,
} from "./public-data.js";
import { appLocationSchema } from "./preferences.js";
import { isoDateStringSchema } from "./runtime.js";
import { z } from "zod";

const publicationRevisionSchema = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);

const movieCollectionBootstrapSchema = movieCatalogDataSchema.extend({
  publicationRevision: publicationRevisionSchema,
});

export const publicPageBootstrapSchema = z.object({
  version: z.literal(1),
  pathname: z.string().min(1).max(2048),
  renderedAt: z.string().datetime({ offset: true }),
  publicationRevision: publicationRevisionSchema,
  catalogs: z.object({
    nowPlaying: movieCollectionBootstrapSchema,
    comingSoon: movieCollectionBootstrapSchema,
  }),
  showtimeCity: z
    .object({
      city: appLocationSchema,
      startDate: isoDateStringSchema,
      endDate: isoDateStringSchema,
      showtimes: z.array(publicShowtimeSchema),
    })
    .optional(),
  targetedMovieShowtimes: z
    .object({
      city: appLocationSchema,
      date: isoDateStringSchema,
      tmdbId: z.string().regex(/^[0-9]{1,12}$/),
      showtimes: z.array(publicShowtimeSchema),
    })
    .optional(),
  cinematheques: z
    .object({
      city: appLocationSchema,
      publicationRevision: publicationRevisionSchema,
      data: publicCinemathequeDataSchema,
    })
    .optional(),
  theaters: publicTheaterDataSchema.optional(),
  cinema: publicCinemaPageDataSchema.optional(),
});

export type PublicPageBootstrap = z.infer<typeof publicPageBootstrapSchema>;
