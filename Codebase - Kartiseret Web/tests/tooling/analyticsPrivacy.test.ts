import { filterAnalyticsEvent } from "../../src/lib/analyticsPrivacy";
import { describe, expect, it } from "vitest";

describe("analytics URL privacy", () => {
  it.each([
    "/reset-password?token=example",
    "/confirm-account-deletion#token=example",
    "/unsubscribe/letterboxd#token=example",
    "/unsubscribe/letterboxd",
    "/RESET-PASSWORD/?token=example",
    "/%72eset-password?token=example",
  ])("drops pageviews and custom events for %s", (path) => {
    const url = `https://seret.site${path}`;
    expect(filterAnalyticsEvent({ type: "pageview", url })).toBeNull();
    expect(filterAnalyticsEvent({ type: "event", url })).toBeNull();
  });

  it("keeps public pageviews and strips query strings and fragments", () => {
    expect(
      filterAnalyticsEvent({
        type: "pageview",
        url: "https://seret.site/showtimes?date=2026-11-23#jerusalem",
      }),
    ).toEqual({ type: "pageview", url: "https://seret.site/showtimes" });
  });

  it("preserves custom event data while cleaning the URL", () => {
    const event = {
      type: "event",
      url: "https://seret.site/movies?code=example#state=example",
      payload: { name: "Browse", data: { source: "menu" } },
    } as const;
    expect(filterAnalyticsEvent(event)).toEqual({
      ...event,
      url: "https://seret.site/movies",
    });
  });

  it("drops events when the URL cannot be parsed", () => {
    expect(
      filterAnalyticsEvent({ type: "pageview", url: "invalid" }),
    ).toBeNull();
  });
});
