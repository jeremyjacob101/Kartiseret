import { citySchema, movieSchema, theaterSchema } from "./movies.js";
import { appLocationSchema } from "./preferences.js";
import {
  httpUrlSchema,
  isoDateStringSchema,
  nonEmptyTrimmedStringSchema,
  showtimeStringSchema,
  tmdbIdSchema,
} from "./runtime.js";
import { z } from "zod";

export const apiErrorSchema = z.object({
  code: nonEmptyTrimmedStringSchema,
  message: nonEmptyTrimmedStringSchema,
});

export const apiErrorResponseSchema = z.object({
  data: z.null(),
  error: apiErrorSchema,
});

export function apiSuccessResponseSchema<Data extends z.ZodType>(data: Data) {
  return z.object({ data, error: z.null() });
}

export const movieCatalogModeSchema = z.enum(["nowPlaying", "comingSoon"]);
export const movieCodesStatusSchema = z.enum(["ready", "failed"]);

export const movieCatalogDataSchema = z.object({
  mode: movieCatalogModeSchema,
  movies: z.array(movieSchema),
  movieCodesStatus: movieCodesStatusSchema,
});
export const movieCatalogResponseSchema = apiSuccessResponseSchema(
  movieCatalogDataSchema,
);

export const publicShowtimeSchema = z.object({
  tmdbId: tmdbIdSchema,
  screeningCity: nonEmptyTrimmedStringSchema,
  dateOfShowing: isoDateStringSchema,
  cinema: nonEmptyTrimmedStringSchema,
  showtime: showtimeStringSchema,
  englishHref: httpUrlSchema.nullable(),
  hebrewHref: httpUrlSchema.nullable(),
  screeningTech: z.string(),
  screeningType: z.string(),
  dubLanguage: z.string().nullable(),
});
export const publicShowtimeRangeDataSchema = z.object({
  showtimes: z.array(publicShowtimeSchema),
});
export const publicShowtimeRangeResponseSchema = apiSuccessResponseSchema(
  publicShowtimeRangeDataSchema,
);

export const ticketAvailabilityShowtimeSchema = publicShowtimeSchema.pick({
  screeningCity: true,
  dateOfShowing: true,
  cinema: true,
  showtime: true,
  englishHref: true,
  hebrewHref: true,
});
export const ticketAvailabilityDataSchema = z.object({
  showtimes: z.array(ticketAvailabilityShowtimeSchema),
});
export const ticketAvailabilityResponseSchema = apiSuccessResponseSchema(
  ticketAvailabilityDataSchema,
);

export const publicTheaterDataSchema = z.object({
  cities: z.array(citySchema),
  theaters: z.array(theaterSchema),
});
export const publicTheaterResponseSchema = apiSuccessResponseSchema(
  publicTheaterDataSchema,
);

const maximumShowtimeRangeDays = 180;
const postgresIntegerMaximum = 2_147_483_647;

function calendarDayNumber(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export const publicShowtimeRangeQuerySchema = z
  .object({
    city: appLocationSchema,
    startDate: isoDateStringSchema,
    endDate: isoDateStringSchema,
    tmdbId: tmdbIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const rangeLength =
      calendarDayNumber(value.endDate) - calendarDayNumber(value.startDate) + 1;

    if (rangeLength < 1 || rangeLength > maximumShowtimeRangeDays) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: `The requested range must contain 1–${maximumShowtimeRangeDays} days.`,
      });
    }

    if (
      value.tmdbId !== undefined &&
      Number(value.tmdbId) > postgresIntegerMaximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["tmdbId"],
        message: "The movie ID is outside the supported database range.",
      });
    }
  });

export const ticketAvailabilityQuerySchema = z
  .object({
    tmdbId: tmdbIdSchema,
    fromDate: isoDateStringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Number(value.tmdbId) > postgresIntegerMaximum) {
      context.addIssue({
        code: "custom",
        path: ["tmdbId"],
        message: "The movie ID is outside the supported database range.",
      });
    }
  });

export const publicMovieCodeSchema = tmdbIdSchema;

export type MovieCatalogData = z.infer<typeof movieCatalogDataSchema>;
export type MovieCatalogMode = z.infer<typeof movieCatalogModeSchema>;
export type MovieCodesStatus = z.infer<typeof movieCodesStatusSchema>;
export type PublicShowtime = z.infer<typeof publicShowtimeSchema>;
export type PublicShowtimeRangeQuery = z.output<
  typeof publicShowtimeRangeQuerySchema
>;
export type TicketAvailabilityShowtime = z.infer<
  typeof ticketAvailabilityShowtimeSchema
>;
export type PublicTheaterData = z.infer<typeof publicTheaterDataSchema>;

export const PUBLICATION_REVISION_HEADER = "X-Kartiseret-Publication";
