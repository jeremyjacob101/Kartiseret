import { accountTicketAlertInputSchema, nullableTicketAlertSubscriptionSchema, ticketAlertMovieIdSchema, ticketAlertShowtimePageSchema, ticketAlertShowtimeRowSchema, userTicketAlertSubscriptionRowsSchema } from "../src/data/ticketAlertSchemas";
import { describe, expect, it } from "vitest";

const userId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-04T09:00:00.123456+00:00";
const subscription = {
  tmdb_id: 42,
  created_at: timestamp,
  notified_at: null,
};
const showtime = {
  screening_city: " Jerusalem ",
  date_of_showing: "2026-09-04",
  showtime: "9:05:00",
  cinema: null,
  english_href: " https://tickets.example.test/42 ",
  hebrew_href: null,
};

describe("ticket alert input schemas", () => {
  it("normalizes account inputs once into numeric IDs and canonical form values", () => {
    expect(
      accountTicketAlertInputSchema.parse({
        tmdbId: 42,
        userId,
        preferredCity: "Jerusalem",
      }).userId,
    ).toBe(userId);
  });

  it.each([
    "42oops",
    "42.5",
    "4e2",
    "0",
    "-1",
    "9007199254740992",
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
  ])("rejects a partial, nonpositive, or unsafe movie ID: %s", (value) => {
    expect(ticketAlertMovieIdSchema.safeParse(value).success).toBe(false);
  });

  it("requires UUID identities and nonblank locations", () => {
    expect(
      accountTicketAlertInputSchema.safeParse({
        tmdbId: 42,
        userId: "wrong",
        preferredCity: "Jerusalem",
      }).success,
    ).toBe(false);
  });
});

describe("ticket alert response schemas", () => {
  it("accepts nullable subscriptions and offset PostgreSQL timestamps", () => {
    expect(nullableTicketAlertSubscriptionSchema.parse(null)).toBeNull();
    expect(
      nullableTicketAlertSubscriptionSchema.parse({
        ...subscription,
        user_id: userId,
      }),
    ).toEqual({ ...subscription, tmdb_id: "42", user_id: userId });
    expect(
      userTicketAlertSubscriptionRowsSchema.parse([
        {
          ...subscription,
          user_id: userId,
          notified_at: "2026-09-04T12:00:00+03:00",
          delivery_title: "A movie",
          delivery_date: "2026-09-05",
          ignored: true,
        },
      ]),
    ).toEqual([
      {
        tmdbId: "42",
        createdAt: timestamp,
        notifiedAt: "2026-09-04T12:00:00+03:00",
        deliveryTitle: "A movie",
        deliveryDate: "2026-09-05",
      },
    ]);
  });

  it("rejects missing columns, invalid timestamps, and impossible delivery dates", () => {
    for (const row of [
      { ...subscription, user_id: userId, created_at: "yesterday" },
      { ...subscription, user_id: userId, notified_at: undefined },
      { ...subscription, user_id: userId, created_at: "2026-02-30T09:00:00Z" },
      { ...subscription, user_id: userId, created_at: "2026-09-04T09:00:00" },
    ]) {
      expect(nullableTicketAlertSubscriptionSchema.safeParse(row).success).toBe(
        false,
      );
    }
    expect(
      userTicketAlertSubscriptionRowsSchema.safeParse([
        {
          ...subscription,
          user_id: userId,
          delivery_title: null,
          delivery_date: "2026-02-30",
        },
      ]).success,
    ).toBe(false);
    expect(
      userTicketAlertSubscriptionRowsSchema.safeParse([subscription]).success,
    ).toBe(false);
  });
});

describe("recoverable ticket alert source schemas", () => {
  it("normalizes showtimes and falls back to a valid Hebrew ticket link", () => {
    expect(ticketAlertShowtimeRowSchema.parse(showtime)).toEqual({
      city: "Jerusalem",
      date: "2026-09-04",
      time: "09:05",
      cinema: "",
      ticketHref: "https://tickets.example.test/42",
    });
    expect(
      ticketAlertShowtimeRowSchema.parse({
        ...showtime,
        english_href: "javascript:alert(1)",
        hebrew_href: "https://tickets.example.test/he",
      }).ticketHref,
    ).toBe("https://tickets.example.test/he");
  });

  it("keeps page positions while skipping unusable rows and rejects malformed page envelopes", () => {
    const badRows = [
      null,
      { ...showtime, date_of_showing: "2026-02-30" },
      { ...showtime, showtime: "19:30garbage" },
      { ...showtime, showtime: "24:00" },
      { ...showtime, screening_city: " " },
      { ...showtime, english_href: "https://user:password@example.test" },
      { ...showtime, english_href: null },
    ];
    const page = ticketAlertShowtimePageSchema.parse([...badRows, showtime]);
    expect(page).toHaveLength(badRows.length + 1);
    expect(page.slice(0, -1)).toEqual(badRows.map(() => null));
    expect(page.at(-1)?.city).toBe("Jerusalem");
    expect(
      ticketAlertShowtimePageSchema.safeParse({ rows: [showtime] }).success,
    ).toBe(false);
  });
});
