import { describe, expect, it, vi } from "vitest";
import { getOrCreateGuestTicketAlertToken, GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, parseGuestTicketAlertReceipts, readGuestTicketAlertToken } from "../src/stores/guestTicketAlertsStore";

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

  it("does not silently replace a malformed bearer token", () => {
    const storage = new Map([
      [GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, "bad-token"],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    expect(readGuestTicketAlertToken()).toBeNull();
    expect(() => getOrCreateGuestTicketAlertToken()).toThrow(
      "credentials are invalid",
    );
    expect(storage.get(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)).toBe("bad-token");
    vi.unstubAllGlobals();
  });
});
