import { z } from "zod";
import {
  appLocationSchema,
  ratingSourceSchema,
  siteColorSchema,
} from "./preferences.js";
import { isoDateStringSchema, tmdbIdSchema } from "./runtime.js";

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
export const subscriptionSchema = z.object({
  tmdbId: tmdbIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  notifiedAt: z.iso.datetime({ offset: true }).nullable(),
  deliveryTitle: z.string().nullable(),
  deliveryDate: isoDateStringSchema.nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;
export const subscriptionCreateSchema = z
  .object({
    tmdbId: protectedMovieIdSchema,
    preferredCity: appLocationSchema.pipe(z.string().max(200)),
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
const envelope = <Schema extends z.ZodType>(data: Schema) =>
  z.object({ data, error: z.null() });
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
