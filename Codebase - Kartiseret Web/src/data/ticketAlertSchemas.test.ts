import { describe, expect, it } from "vitest";
import { accountTicketAlertInputSchema, cancelledGuestTicketAlertCountSchema, guestTicketAlertInputSchema, guestTicketAlertResponseSchema, guestTicketAlertsStorageSchema, guestTicketAlertTokenSchema, nullableTicketAlertSubscriptionSchema, ticketAlertEmailSchema, ticketAlertMovieIdSchema, ticketAlertShowtimePageSchema, ticketAlertShowtimeRowSchema, userTicketAlertSubscriptionRowsSchema } from "./ticketAlertSchemas";

const userId = "11111111-1111-4111-8111-111111111111";
const guestToken = "abcdefab-1234-4123-8123-abcdefabcdef";
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
  it("normalizes inputs once into numeric RPC IDs and canonical form values", () => {
    expect(
      guestTicketAlertInputSchema.parse({
        tmdbId: " 42 ",
        email: " Viewer+Alerts@Example.TEST ",
        preferredCity: " Tel   Aviv ",
        movieCode: "A7z",
        ignored: true,
      }),
    ).toEqual({
      tmdbId: 42,
      email: "viewer+alerts@example.test",
      preferredCity: "Tel Aviv",
      movieCode: "A7z",
    });
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

  it("keeps the SQL email contract, including international addresses", () => {
    expect(ticketAlertEmailSchema.parse(" שלום@דוגמה.ישראל ")).toBe(
      "שלום@דוגמה.ישראל",
    );
    for (const email of [
      "",
      "viewer",
      "a b@example.test",
      "a<@example.test",
      'a"@example.test',
      "a\\b@example.test",
      `${"a".repeat(310)}@example.test`,
    ]) {
      expect(ticketAlertEmailSchema.safeParse(email).success).toBe(false);
    }
  });

  it("requires UUID identities and nonblank locations", () => {
    expect(
      guestTicketAlertTokenSchema.parse(` ${guestToken.toUpperCase()} `),
    ).toBe(guestToken);
    expect(guestTicketAlertTokenSchema.safeParse("browser-token").success).toBe(
      false,
    );
    expect(
      accountTicketAlertInputSchema.safeParse({
        tmdbId: 42,
        userId: "wrong",
        preferredCity: "Jerusalem",
      }).success,
    ).toBe(false);
    expect(
      guestTicketAlertInputSchema.safeParse({
        tmdbId: 42,
        email: "a@example.test",
        preferredCity: " ",
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
        { ...subscription, delivery_title: null, delivery_date: "2026-02-30" },
      ]).success,
    ).toBe(false);
    expect(
      userTicketAlertSubscriptionRowsSchema.safeParse([subscription]).success,
    ).toBe(false);
  });

  it("requires exactly one complete guest creation response and an integer cancellation result", () => {
    const created = {
      ...subscription,
      guest_token: guestToken,
      email: "a@example.test",
      preferred_city: "Jerusalem",
    };
    expect(guestTicketAlertResponseSchema.parse([created])[0].tmdb_id).toBe(
      "42",
    );
    for (const response of [
      null,
      [],
      [created, created],
      created,
      [{ ...created, guest_token: "invalid" }],
      [{ ...created, preferred_city: null }],
    ]) {
      expect(guestTicketAlertResponseSchema.safeParse(response).success).toBe(
        false,
      );
    }
    expect(cancelledGuestTicketAlertCountSchema.parse(0)).toBe(0);
    expect(cancelledGuestTicketAlertCountSchema.parse(1)).toBe(1);
    for (const count of [null, "1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        cancelledGuestTicketAlertCountSchema.safeParse(count).success,
      ).toBe(false);
    }
  });
});

describe("recoverable ticket alert source and storage schemas", () => {
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

  it("recovers valid stored entries without trusting malformed IDs or values", () => {
    const stored = {
      email: " Viewer@Example.TEST ",
      subscribedAt: timestamp,
      ignored: true,
    };
    expect(
      guestTicketAlertsStorageSchema.parse({
        " 42 ": stored,
        "43": { ...stored, subscribedAt: "not-a-date" },
        "44": { ...stored, email: "invalid" },
        "45": null,
        "46": { email: "a@example.test" },
        "42oops": stored,
        "9007199254740992": stored,
      }),
    ).toEqual({
      "42": { email: "viewer@example.test", subscribedAt: timestamp },
    });
    expect(guestTicketAlertsStorageSchema.safeParse([]).success).toBe(false);
    expect(guestTicketAlertsStorageSchema.safeParse(null).success).toBe(false);
  });
});
