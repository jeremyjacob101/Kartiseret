import { z } from "zod";
import {
  ALL_LOCATIONS,
  appLocationSchema,
  ratingSourceSchema,
  siteColorSchema,
} from "./preferences.js";
import { isoDateStringSchema, tmdbIdSchema } from "./runtime.js";
import {
  SHOWTIME_FILTER_OPTIONS,
  type ShowtimeFilterGroup,
} from "./showtime-links.js";
import {
  buildShowtimeFilterSelections,
  getCanonicalShowtimeMeta,
  type FilterableShowtime,
} from "./showtime-filters.js";

const envelope = <Schema extends z.ZodType>(data: Schema) =>
  z.object({ data, error: z.null() });

export const EXPECTED_ACCOUNT_HEADER = "X-Kartiseret-Account-Id";
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const accountPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "Password must be at least 8 characters.")
  .max(PASSWORD_MAX_LENGTH, "Password must be at most 128 characters.");

export const applicationIdentitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
});
export type ApplicationIdentity = z.infer<typeof applicationIdentitySchema>;
export const preferencesSchema = z
  .object({
    ratingSources: z.array(ratingSourceSchema).max(5),
    location: appLocationSchema.pipe(z.string().max(200)),
    siteColor: siteColorSchema,
  })
  .strict();
export const preferencePatchSchema = preferencesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const initializePreferencesSchema = z
  .object({
    fallbackLocation: appLocationSchema.pipe(z.string().max(200)).optional(),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencePatch = z.infer<typeof preferencePatchSchema>;
export const protectedMovieIdSchema = tmdbIdSchema.refine(
  (value) => BigInt(value) <= 2_147_483_647n,
  "Movie ID exceeds the catalog range.",
);
export const subscriptionMovieIdSchema = tmdbIdSchema.refine(
  (value) => BigInt(value) <= 9_223_372_036_854_775_807n,
  "Movie ID exceeds PostgreSQL bigint range.",
);
export const movieDisplayTreatmentSchema = z.enum(["standard", "remove"]);
export const movieDisplayPreferenceSchema = z
  .object({
    tmdbId: subscriptionMovieIdSchema,
    title: z.string().trim().min(1).max(200),
    releaseYear: z.number().int().min(1870).max(2200).nullable(),
    treatment: movieDisplayTreatmentSchema,
    hideBackdrop: z.boolean(),
  })
  .strict();
export type MovieDisplayPreference = z.infer<
  typeof movieDisplayPreferenceSchema
>;
export const movieDisplayPreferenceListResponseSchema = envelope(
  z.object({
    preferences: z.array(movieDisplayPreferenceSchema).max(500),
  }),
);
export const movieDisplayPreferenceCreateSchema = movieDisplayPreferenceSchema;
export const movieDisplayPreferencePatchSchema = z
  .object({
    treatment: movieDisplayTreatmentSchema.optional(),
    hideBackdrop: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const movieDisplayPreferenceChangeSchema = envelope(
  z.object({ preference: movieDisplayPreferenceSchema }),
);
export const movieDisplayPreferenceRemoveSchema = envelope(
  z.object({ removed: z.literal(true) }),
);
const ticketAlertCitiesSchema = z
  .array(z.enum(ALL_LOCATIONS))
  .max(ALL_LOCATIONS.length);
export const ticketAlertFiltersSchema = z
  .object({
    showType: z
      .array(z.enum(SHOWTIME_FILTER_OPTIONS.showType))
      .max(SHOWTIME_FILTER_OPTIONS.showType.length),
    screenFormat: z
      .array(z.enum(SHOWTIME_FILTER_OPTIONS.screenFormat))
      .max(SHOWTIME_FILTER_OPTIONS.screenFormat.length),
    screeningTech: z
      .array(z.enum(SHOWTIME_FILTER_OPTIONS.screeningTech))
      .max(SHOWTIME_FILTER_OPTIONS.screeningTech.length),
    dubLanguage: z
      .array(z.enum(SHOWTIME_FILTER_OPTIONS.dubLanguage))
      .max(SHOWTIME_FILTER_OPTIONS.dubLanguage.length),
  })
  .strict();
export const ticketAlertCriteriaSchema = z
  .object({
    // null means all cities; an empty array means no cities.
    cities: ticketAlertCitiesSchema.nullable(),
    // Values are unchecked exclusions, matching the showtime filter UI.
    filters: ticketAlertFiltersSchema,
  })
  .strict();
export const ticketAlertCriteriaOverrideSchema = z
  .object({
    cities: ticketAlertCitiesSchema.nullable().optional(),
    filters: ticketAlertFiltersSchema.partial().strict().optional(),
  })
  .strict();
export type TicketAlertCriteria = z.infer<typeof ticketAlertCriteriaSchema>;
export type TicketAlertCriteriaOverride = z.infer<
  typeof ticketAlertCriteriaOverrideSchema
>;
export const DEFAULT_TICKET_ALERT_CRITERIA: TicketAlertCriteria = {
  cities: null,
  filters: {
    showType: [],
    screenFormat: [],
    screeningTech: [],
    dubLanguage: [],
  },
};

export type TicketAlertShowtime = FilterableShowtime & { city: string };
export function resolveTicketAlertCriteria(
  defaults: TicketAlertCriteria,
  overrides: TicketAlertCriteriaOverride = {},
): TicketAlertCriteria {
  const groups = Object.keys(SHOWTIME_FILTER_OPTIONS) as ShowtimeFilterGroup[];
  const filters = Object.fromEntries(
    groups.map((group) => [
      group,
      overrides.filters?.[group] ?? defaults.filters[group],
    ]),
  ) as TicketAlertCriteria["filters"];
  return {
    cities: overrides.cities === undefined ? defaults.cities : overrides.cities,
    filters,
  };
}

export function matchesTicketAlertCriteria(
  showtime: TicketAlertShowtime,
  criteria: TicketAlertCriteria,
): boolean {
  if (
    criteria.cities !== null &&
    !(criteria.cities as readonly string[]).includes(showtime.city)
  )
    return false;
  const selections = buildShowtimeFilterSelections(SHOWTIME_FILTER_OPTIONS, {
    version: 3,
    unchecked: criteria.filters,
  });
  const metadata = getCanonicalShowtimeMeta(showtime);
  return (
    (criteria.filters.showType.length === 0 ||
      metadata.showTypeTokens.some((token) =>
        selections.showType.has(token),
      )) &&
    (criteria.filters.screenFormat.length === 0 ||
      selections.screenFormat.has(metadata.screenFormatToken)) &&
    (criteria.filters.screeningTech.length === 0 ||
      metadata.screeningTechTokens.some((token) =>
        selections.screeningTech.has(token),
      )) &&
    (criteria.filters.dubLanguage.length === 0 ||
      selections.dubLanguage.has(metadata.dubLanguage))
  );
}

export const subscriptionSchema = z.object({
  tmdbId: tmdbIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  notifiedAt: z.iso.datetime({ offset: true }).nullable(),
  deliveryTitle: z.string().nullable(),
  deliveryDate: isoDateStringSchema.nullable(),
  criteriaOverrides: z
    .object({
      cities: ticketAlertCitiesSchema.nullable().optional(),
      filters: ticketAlertFiltersSchema.partial().strict().optional(),
    })
    .strict(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const ticketAlertPreferencesResponseSchema = envelope(
  z.object({ preferences: ticketAlertCriteriaSchema }),
);
export const ticketAlertPreferencesUpdateSchema = ticketAlertCriteriaSchema;
export const ticketAlertCriteriaUpdateSchema = z
  .object({
    criteriaOverrides: ticketAlertCriteriaOverrideSchema,
  })
  .strict();

export const comingSoonDateWatchSchema = z.object({
  tmdbId: tmdbIdSchema,
  title: z.string().trim().min(1).max(200),
  releaseYear: z.number().int().min(1870).max(2200).nullable(),
  posterPath: z
    .string()
    .regex(/^\/[A-Za-z0-9_./-]+$/)
    .nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  notifiedAt: z.iso.datetime({ offset: true }).nullable(),
  comingSoonDate: isoDateStringSchema.nullable(),
});
export type ComingSoonDateWatch = z.infer<typeof comingSoonDateWatchSchema>;
export const comingSoonDateWatchListResponseSchema = envelope(
  z.object({ watches: z.array(comingSoonDateWatchSchema) }),
);
export const comingSoonDateWatchCreateSchema = z
  .object({
    tmdbId: subscriptionMovieIdSchema,
    title: z.string().trim().min(1).max(200),
    releaseYear: z.number().int().min(1870).max(2200).nullable(),
    posterPath: z
      .string()
      .regex(/^\/[A-Za-z0-9_./-]+$/)
      .nullable(),
  })
  .strict();
export const comingSoonDateWatchChangeSchema = envelope(
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("watching"),
      watch: comingSoonDateWatchSchema,
    }),
    z.object({
      kind: z.literal("known"),
      tmdbId: tmdbIdSchema,
      title: z.string().trim().min(1).max(200),
      comingSoonDate: isoDateStringSchema,
    }),
  ]),
);
export type ComingSoonDateWatchChange = z.infer<
  typeof comingSoonDateWatchChangeSchema
>["data"];

export const letterboxdSourceIdSchema = z.string().uuid();
export const letterboxdSourceSchema = z.object({
  id: letterboxdSourceIdSchema,
  sourceUrl: z.string().url(),
  sourceType: z.enum(["watchlist", "list"]),
  createdAt: z.iso.datetime({ offset: true }),
  lastSyncAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  lastSuccessfulSyncAt: z.iso.datetime({ offset: true }).nullable(),
  lastSyncError: z.string().max(500).nullable(),
  filmCount: z.number().int().nonnegative(),
  matchedFilmCount: z.number().int().nonnegative(),
});
export type LetterboxdSource = z.infer<typeof letterboxdSourceSchema>;
export const letterboxdSourceListResponseSchema = envelope(
  z.object({ sources: z.array(letterboxdSourceSchema).max(50) }),
);
export const letterboxdSourceCreateSchema = z
  .object({ sourceUrl: z.string().trim().min(1).max(500) })
  .strict();
export const letterboxdSourceChangeSchema = envelope(
  z.object({ source: letterboxdSourceSchema }),
);
export const letterboxdSourceRemoveResponseSchema = envelope(
  z.object({ removed: z.literal(true) }),
);

export const subscriptionCreateSchema = z
  .object({
    tmdbId: protectedMovieIdSchema,
  })
  .strict();
export const subscriptionListQuerySchema = z
  .object({ offset: z.coerce.number().int().min(0).max(1_000_000).default(0) })
  .strict();
export const correctionSchema = z
  .object({
    mode: z.enum(["nowPlaying", "comingSoon"]),
    currentTmdbId: protectedMovieIdSchema,
    selectedTmdbId: protectedMovieIdSchema,
    selectedTitle: z.string().trim().max(1000).nullable().optional(),
    selectedYear: z.number().int().positive().max(9999).nullable().optional(),
    selectedPosterUrl: z.string().max(2048).nullable().optional(),
    isManualEntry: z.boolean(),
  })
  .strict();
export type Correction = z.infer<typeof correctionSchema>;
export const accountResponseSchema = envelope(
  z.object({ user: applicationIdentitySchema, isAdmin: z.boolean() }),
);
export const preferencesResponseSchema = envelope(preferencesSchema);
export const subscriptionsResponseSchema = envelope(
  z.object({
    subscriptions: z.array(subscriptionSchema),
    nextOffset: z.number().int().nullable(),
  }),
);
export const subscriptionChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available") }),
  z.object({
    kind: z.literal("account"),
    subscription: subscriptionSchema.nullable(),
  }),
]);
export type SubscriptionChange = z.infer<typeof subscriptionChangeSchema>;
export const subscriptionChangeResponseSchema = envelope(
  subscriptionChangeSchema,
);
export const correctionResponseSchema = envelope(
  z.object({ changed: z.boolean() }),
);
