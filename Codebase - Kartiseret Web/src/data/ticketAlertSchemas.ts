import { z } from "zod";
import { supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { appLocationSchema } from "../prefs/definitions/locations";
import { httpUrlSchema, isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, showtimeStringSchema, tmdbIdSchema } from "../validation/runtime";

// Match the guest-alert SQL constraint, including its international-email support.
export const ticketAlertEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "Enter a valid email address for this alert.")
  .regex(
    /^[^\s@<>()"'\\]+@[^\s@<>()"'\\]+\.[^\s@<>()"'\\]+$/,
    "Enter a valid email address for this alert.",
  );

// RPCs use numeric bigint arguments. Reject partial or unsafe IDs before conversion.
export const ticketAlertMovieIdSchema = tmdbIdSchema
  .transform(Number)
  .pipe(z.number().int().positive().safe());
export const guestTicketAlertTokenSchema = z
  .string()
  .trim()
  .toLowerCase()
  .uuid();
const timestampSchema = z.iso.datetime({ offset: true });

const ticketAlertContextSchema = z.object({
  movieCode: movieCodeSchema.optional(),
  preferredCity: appLocationSchema,
  tmdbId: ticketAlertMovieIdSchema,
});
export const ticketAlertStateInputSchema = ticketAlertContextSchema.extend({
  userId: supabaseUserIdSchema.nullable(),
});
export const accountTicketAlertInputSchema = ticketAlertContextSchema.extend({
  userId: supabaseUserIdSchema,
});
export const guestTicketAlertInputSchema = ticketAlertContextSchema.extend({
  email: ticketAlertEmailSchema,
});
export const accountTicketAlertIdentitySchema =
  accountTicketAlertInputSchema.pick({
    userId: true,
    tmdbId: true,
  });

const subscriptionColumns = {
  tmdb_id: tmdbIdSchema,
  created_at: timestampSchema,
  notified_at: timestampSchema.nullable(),
};
export const ticketAlertSubscriptionRowSchema = z.object({
  ...subscriptionColumns,
  user_id: supabaseUserIdSchema,
});
export const nullableTicketAlertSubscriptionSchema =
  ticketAlertSubscriptionRowSchema.nullable();
export const userTicketAlertSubscriptionRowSchema = z.object({
  ...subscriptionColumns,
  delivery_title: z.string().nullable(),
  delivery_date: isoDateStringSchema.nullable(),
});
const userTicketAlertSubscriptionSchema =
  userTicketAlertSubscriptionRowSchema.transform((row) => ({
    tmdbId: row.tmdb_id,
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    deliveryTitle: row.delivery_title,
    deliveryDate: row.delivery_date,
  }));
export const userTicketAlertSubscriptionRowsSchema =
  userTicketAlertSubscriptionSchema.array();
export const guestTicketAlertResponseSchema = z.tuple([
  z.object({
    ...subscriptionColumns,
    guest_token: guestTicketAlertTokenSchema,
    email: ticketAlertEmailSchema,
    preferred_city: appLocationSchema,
  }),
]);
export const cancelledGuestTicketAlertCountSchema = z
  .number()
  .int()
  .nonnegative()
  .safe();

// Source listings are recoverable: invalid links fall back to the other language,
// and an unusable row is skipped without hiding valid listings on the same page.
const optionalTicketHrefSchema = httpUrlSchema.nullish().catch(null);
export const ticketAlertShowtimeRowSchema = z
  .object({
    screening_city: nonEmptyTrimmedStringSchema,
    date_of_showing: isoDateStringSchema,
    showtime: showtimeStringSchema,
    cinema: z.string().trim().nullish(),
    english_href: optionalTicketHrefSchema,
    hebrew_href: optionalTicketHrefSchema,
  })
  .transform((row, context) => {
    const ticketHref = row.english_href ?? row.hebrew_href;

    if (!ticketHref) {
      context.addIssue({
        code: "custom",
        message: "Expected a usable ticket URL.",
      });
      return z.NEVER;
    }

    const [hour, minute] = row.showtime.split(":");
    return {
      city: row.screening_city,
      cinema: row.cinema ?? "",
      date: row.date_of_showing,
      time: `${hour.padStart(2, "0")}:${minute}`,
      ticketHref,
    };
  });
export const ticketAlertShowtimePageSchema = ticketAlertShowtimeRowSchema
  .nullable()
  .catch(null)
  .array();

const storedGuestTicketAlertSchema = z.object({
  email: ticketAlertEmailSchema,
  subscribedAt: timestampSchema,
});
const storedGuestTicketAlertEntrySchema = z.object({
  tmdbId: ticketAlertMovieIdSchema.transform(String),
  subscription: storedGuestTicketAlertSchema,
});
export const guestTicketAlertsStorageSchema = z
  .record(z.string(), z.unknown())
  .transform((entries) => {
    const subscriptions: Record<string, StoredGuestTicketAlert> = {};
    for (const [tmdbId, subscription] of Object.entries(entries)) {
      const result = storedGuestTicketAlertEntrySchema.safeParse({
        tmdbId,
        subscription,
      });
      if (result.success) {
        subscriptions[result.data.tmdbId] = result.data.subscription;
      }
    }
    return subscriptions;
  });

export type TicketAlertSubscriptionRow = z.infer<
  typeof ticketAlertSubscriptionRowSchema
>;
export type UserTicketAlertSubscription = z.infer<
  typeof userTicketAlertSubscriptionSchema
>;
export type TicketAlertShowtime = z.infer<typeof ticketAlertShowtimeRowSchema>;
export type StoredGuestTicketAlert = z.infer<
  typeof storedGuestTicketAlertSchema
>;
export type TicketAlertStateOptions = z.input<
  typeof ticketAlertStateInputSchema
>;
export type ValidatedTicketAlertStateOptions = z.output<
  typeof ticketAlertStateInputSchema
>;
export type TicketAlertActionOptions = z.input<
  typeof accountTicketAlertInputSchema
>;
export type GuestTicketAlertActionOptions = z.input<
  typeof guestTicketAlertInputSchema
>;
