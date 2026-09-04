import { describe, expect, it } from "vitest";
import { parseGuestTicketAlertReceipts } from "./guestTicketAlertsStore";

describe("guest receipt storage compatibility", () => {
  it("reads the existing versioned shape and discards malformed entries individually", () => {
    expect(
      parseGuestTicketAlertReceipts(
        JSON.stringify({
          "00101": {
            email: " Guest@Example.test ",
            subscribedAt: "2026-09-04T12:00:00Z",
          },
          invalid: { email: "guest@example.test", subscribedAt: "2026-09-04" },
          "202": { email: "invalid", subscribedAt: "2026-09-04" },
          "303": null,
        }),
      ),
    ).toEqual({
      "101": {
        email: "guest@example.test",
        subscribedAt: "2026-09-04T12:00:00Z",
      },
    });
  });

  it("tolerates absent, malformed and non-object storage", () => {
    for (const raw of [null, "{bad json", "[]", "null", "42"]) {
      expect(parseGuestTicketAlertReceipts(raw)).toEqual({});
    }
  });
});
