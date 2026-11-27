import { z } from "zod";
import {
  ALL_LOCATIONS,
  DEFAULT_LOCATION,
  appLocationSchema,
  hideReReleasesSchema,
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
import { persistedShowtimePreferencesSchema } from "./showtime-preferences.js";

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
export const notificationDeliverySchema = z.enum([
  "email",
  "iphone",
  "both",
  "neither",
]);
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export const pushDeviceRegistrationSchema = z
  .object({
    token: z.string().regex(/^(?:[0-9a-f]{2}){16,64}$/i),
    environment: z.enum(["development", "production"]),
  })
  .strict();
export const pushDeviceUnregisterSchema = z
  .object({
    token: z.string().regex(/^(?:[0-9a-f]{2}){16,64}$/i),
  })
  .strict();
export const pushDeviceStatusQuerySchema = z
  .object({
    token: z
      .string()
      .regex(/^(?:[0-9a-f]{2}){16,64}$/i)
      .optional(),
  })
  .strict();
export type PushDeviceRegistration = z.infer<
  typeof pushDeviceRegistrationSchema
>;
export const preferencesSchema = z
  .object({
    ratingSources: z.array(ratingSourceSchema).max(5),
    location: appLocationSchema.pipe(z.string().max(200)),
    siteColor: siteColorSchema,
    hideReReleases: hideReReleasesSchema,
    notificationDelivery: notificationDeliverySchema,
    showtimePreferences: persistedShowtimePreferencesSchema,
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
export const MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE = 500;
export const movieDisplayPreferenceListQuerySchema = z
  .object({ after: subscriptionMovieIdSchema.optional() })
  .strict();
export const movieDisplayPreferenceListResponseSchema = envelope(
  z.object({
    preferences: z
      .array(movieDisplayPreferenceSchema)
      .max(MOVIE_DISPLAY_PREFERENCE_PAGE_SIZE),
    nextCursor: subscriptionMovieIdSchema.nullable(),
  }),
);
export type MovieDisplayPreferencePage = z.infer<
  typeof movieDisplayPreferenceListResponseSchema
>["data"];
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
export const notificationModeSchema = z.enum([
  "first_any_city",
  "first_per_city",
]);
export const ticketAlertCriteriaSchema = z
  .object({
    // null follows the preferred city; an empty array means no cities.
    cities: ticketAlertCitiesSchema.nullable(),
    notificationMode: notificationModeSchema.default("first_any_city"),
    // Values are unchecked exclusions, matching the showtime filter UI.
    filters: ticketAlertFiltersSchema,
  })
  .strict();
export const ticketAlertCriteriaOverrideSchema = z
  .object({
    cities: ticketAlertCitiesSchema.nullable().optional(),
    notificationMode: notificationModeSchema.optional(),
    filters: ticketAlertFiltersSchema.partial().strict().optional(),
  })
  .strict();
export type TicketAlertCriteria = z.infer<typeof ticketAlertCriteriaSchema>;
export type TicketAlertCriteriaOverride = z.infer<
  typeof ticketAlertCriteriaOverrideSchema
>;
export const DEFAULT_TICKET_ALERT_CRITERIA: TicketAlertCriteria = {
  cities: null,
  notificationMode: "first_any_city",
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
  preferredCity: string = DEFAULT_LOCATION,
): TicketAlertCriteria {
  const groups = Object.keys(SHOWTIME_FILTER_OPTIONS) as ShowtimeFilterGroup[];
  const filters = Object.fromEntries(
    groups.map((group) => [
      group,
      overrides.filters?.[group] ?? defaults.filters[group],
    ]),
  ) as TicketAlertCriteria["filters"];
  return {
    cities: (overrides.cities === undefined
      ? defaults.cities
      : overrides.cities) ?? [
      ALL_LOCATIONS.find((city) => city === preferredCity) ?? "Jerusalem",
    ],
    notificationMode:
      overrides.notificationMode ??
      defaults.notificationMode ??
      "first_any_city",
    filters,
  };
}

export function matchesTicketAlertCriteria(
  showtime: TicketAlertShowtime,
  criteria: TicketAlertCriteria,
): boolean {
  if (
    !((criteria.cities ?? [DEFAULT_LOCATION]) as readonly string[]).includes(
      showtime.city,
    )
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
  criteriaOverrides: ticketAlertCriteriaOverrideSchema,
  completedCities: z.array(z.string()).default([]),
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
export const pushDeviceStatusResponseSchema = envelope(
  z.object({ registered: z.boolean() }),
);
export const pushDeviceChangeResponseSchema = envelope(
  z.object({ registered: z.boolean() }),
);
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

export const walletTicketIdSchema = z.string().uuid();
const ticketScreeningTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ticketLabelSchema = z.string().trim().min(1).max(200);
export const walletTicketScreeningSchema = z
  .object({
    tmdbId: protectedMovieIdSchema.nullable(),
    title: ticketLabelSchema,
    city: ticketLabelSchema,
    cinema: ticketLabelSchema,
    screeningDate: isoDateStringSchema,
    screeningTime: ticketScreeningTimeSchema,
  })
  .strict();
const walletQrMessageSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 2048);
export const MAX_WALLET_TICKET_QR_CODES = 10;
export const walletQrMessagesSchema = z
  .array(walletQrMessageSchema)
  .min(1, "Add at least one ticket QR code.")
  .max(
    MAX_WALLET_TICKET_QR_CODES,
    `A booking can contain up to ${MAX_WALLET_TICKET_QR_CODES} ticket QR codes.`,
  );
export const walletTicketCreateSchema = walletTicketScreeningSchema
  .extend({
    // qrMessage is retained for older signed-in clients. New clients submit
    // qrMessages so one booking can contain several family admissions.
    qrMessage: walletQrMessageSchema.optional(),
    qrMessages: walletQrMessagesSchema.optional(),
    reminderEnabled: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      (value.qrMessage !== undefined) !== (value.qrMessages !== undefined),
    {
      path: ["qrMessages"],
      message: "Provide qrMessage or qrMessages, but not both.",
    },
  );
export const walletTicketPatchSchema = z
  .object({
    ...walletTicketScreeningSchema.shape,
    qrMessage: walletQrMessageSchema,
    reminderEnabled: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type WalletTicketCreate = z.infer<typeof walletTicketCreateSchema>;
export type WalletTicketPatch = z.infer<typeof walletTicketPatchSchema>;
export const walletTicketSchema = z
  .object({
    id: walletTicketIdSchema,
    ...walletTicketScreeningSchema.shape,
    reminderEnabled: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type WalletTicket = z.infer<typeof walletTicketSchema>;
export const walletTicketDetailSchema = walletTicketSchema.extend({
  qrMessage: walletQrMessageSchema,
  qrCodes: z
    .array(
      z
        .object({ id: walletTicketIdSchema, qrMessage: walletQrMessageSchema })
        .strict(),
    )
    .min(1)
    .max(MAX_WALLET_TICKET_QR_CODES),
});
export type WalletTicketDetail = z.infer<typeof walletTicketDetailSchema>;
export const walletTicketQrCodesAppendSchema = z
  .object({ qrMessages: walletQrMessagesSchema })
  .strict();
export type WalletTicketQrCodesAppend = z.infer<
  typeof walletTicketQrCodesAppendSchema
>;
export const walletTicketListResponseSchema = envelope(
  z.object({ tickets: z.array(walletTicketSchema).max(100) }),
);
export const walletTicketDetailResponseSchema = envelope(
  z.object({ ticket: walletTicketDetailSchema }),
);
export const walletTicketDetailsResponseSchema = envelope(
  z.object({ tickets: z.array(walletTicketDetailSchema).max(100) }),
);
export const walletTicketChangeResponseSchema = envelope(
  z.object({ ticket: walletTicketSchema }),
);
export const walletTicketRemoveResponseSchema = envelope(
  z.object({ removed: z.literal(true) }),
);
export const walletTicketRecentClickCreateSchema =
  walletTicketScreeningSchema.extend({
    tmdbId: protectedMovieIdSchema,
  });
export type WalletTicketRecentClick = z.infer<
  typeof walletTicketRecentClickCreateSchema
>;
export const walletListedScreeningsQuerySchema = z
  .object({
    city: ticketLabelSchema,
    date: isoDateStringSchema,
  })
  .strict();
export const walletListedScreeningsResponseSchema = envelope(
  z.object({
    screenings: z.array(walletTicketRecentClickCreateSchema).max(250),
  }),
);
export const walletTicketRecentClickRequestSchema =
  walletTicketRecentClickCreateSchema
    .extend({
      expectedAccountId: applicationIdentitySchema.shape.id.optional(),
      clickedAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict();
export const walletTicketRecentClickResponseSchema = envelope(
  z.object({ screening: walletTicketRecentClickCreateSchema.nullable() }),
);
