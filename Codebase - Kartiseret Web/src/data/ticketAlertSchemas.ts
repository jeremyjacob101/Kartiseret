import { z } from "zod";
import { supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { appLocationSchema } from "../prefs/definitions/locations";
import { httpUrlSchema, isoDateStringSchema, movieCodeSchema, nonEmptyTrimmedStringSchema, showtimeStringSchema, tmdbIdSchema } from "../validation/runtime";

// The database uses bigint movie IDs. Reject partial or unsafe IDs before conversion.
export const ticketAlertMovieIdSchema = tmdbIdSchema
  .transform(Number)
  .pipe(z.number().int().positive().safe());
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
export const accountTicketAlertIdentitySchema =
  accountTicketAlertInputSchema.pick({
    userId: true,
    tmdbId: true,
  });
export const ticketAlertChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("subscribe"),
    preferredCity: appLocationSchema,
  }),
]);

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
  user_id: supabaseUserIdSchema,
  delivery_title: z.string().nullable(),
  delivery_date: isoDateStringSchema.nullable(),
});
export const userTicketAlertSubscriptionSchema =
  userTicketAlertSubscriptionRowSchema.transform((row) => ({
    tmdbId: row.tmdb_id,
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    deliveryTitle: row.delivery_title,
    deliveryDate: row.delivery_date,
  }));
export const userTicketAlertSubscriptionRowsSchema =
  userTicketAlertSubscriptionSchema.array();
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

export type TicketAlertSubscriptionRow = z.infer<
  typeof ticketAlertSubscriptionRowSchema
>;
export type UserTicketAlertSubscription = z.infer<
  typeof userTicketAlertSubscriptionSchema
>;
export type TicketAlertShowtime = z.infer<typeof ticketAlertShowtimeRowSchema>;
export type TicketAlertStateOptions = z.input<
  typeof ticketAlertStateInputSchema
>;
export type ValidatedTicketAlertStateOptions = z.output<
  typeof ticketAlertStateInputSchema
>;
export type TicketAlertActionOptions = z.input<
  typeof accountTicketAlertInputSchema
>;
export type TicketAlertChange = z.input<typeof ticketAlertChangeSchema>;
