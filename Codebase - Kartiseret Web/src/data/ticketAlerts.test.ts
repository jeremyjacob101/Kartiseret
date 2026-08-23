import { describe, expect, it } from "vitest";
import { buildTicketAlertShowtimePath, getValidTicketHref, selectTicketAlertShowtime, type TicketAlertShowtimeRow } from "./ticketAlerts";

const TEST_INSTANT = new Date("2026-08-23T12:00:00.000Z");

function showtimeRow(
  overrides: Partial<TicketAlertShowtimeRow> = {},
): TicketAlertShowtimeRow {
  return {
    screening_city: "Tel Aviv",
    date_of_showing: "2026-08-24",
    showtime: "18:00:00",
    cinema: "Cinema City",
    english_href: "https://tickets.example/showing/1",
    hebrew_href: null,
    ...overrides,
  };
}

describe("ticket alert showtime selection", () => {
  it("prefers the earliest linked showtime in the saved city", () => {
    const selected = selectTicketAlertShowtime(
      [
        showtimeRow({ showtime: "10:00:00" }),
        showtimeRow({
          screening_city: "Jerusalem",
          showtime: "21:00:00",
          english_href: "https://tickets.example/showing/jerusalem-late",
        }),
        showtimeRow({
          screening_city: "Jerusalem",
          showtime: "17:30:00",
          english_href: "https://tickets.example/showing/jerusalem-early",
        }),
      ],
      "Jerusalem",
      TEST_INSTANT,
    );

    expect(selected).toMatchObject({
      city: "Jerusalem",
      time: "17:30",
      ticketHref: "https://tickets.example/showing/jerusalem-early",
    });
  });

  it("falls back to the earliest linked showtime anywhere", () => {
    const selected = selectTicketAlertShowtime(
      [
        showtimeRow({ showtime: "20:00:00" }),
        showtimeRow({
          screening_city: "Haifa",
          showtime: "16:00:00",
          english_href: "https://tickets.example/showing/haifa",
        }),
      ],
      "Jerusalem",
      TEST_INSTANT,
    );

    expect(selected).toMatchObject({ city: "Haifa", time: "16:00" });
  });

  it("ignores expired, malformed, and unlinked rows", () => {
    const selected = selectTicketAlertShowtime(
      [
        showtimeRow({
          date_of_showing: "2026-08-23",
          showtime: "14:00:00",
        }),
        showtimeRow({ english_href: "javascript:alert(1)" }),
        showtimeRow({ english_href: "none", hebrew_href: null }),
      ],
      "Tel Aviv",
      TEST_INSTANT,
    );

    expect(selected).toBeNull();
  });
});

describe("ticket alert links", () => {
  it("uses a Hebrew ticket URL when the English URL is invalid", () => {
    expect(
      getValidTicketHref({
        english_href: "none",
        hebrew_href: "https://tickets.example/he/2",
      }),
    ).toBe("https://tickets.example/he/2");
  });

  it("matches the frontend route codec for a linked day", () => {
    expect(
      buildTicketAlertShowtimePath(
        "Ab9",
        { city: "Jerusalem", date: "2026-08-24" },
        TEST_INSTANT,
      ),
    ).toBe("/Ab9iRj");
  });

  it("falls back to a plain movie link outside the 62-day route window", () => {
    expect(
      buildTicketAlertShowtimePath(
        "Ab9",
        { city: "Jerusalem", date: "2026-12-18" },
        TEST_INSTANT,
      ),
    ).toBe("/Ab9");
  });

  it("falls back to all showtimes when a movie has no route code", () => {
    expect(
      buildTicketAlertShowtimePath(
        undefined,
        { city: "Jerusalem", date: "2026-08-24" },
        TEST_INSTANT,
      ),
    ).toBe("/showtimes");
  });
});
