import { describe, expect, it } from "vitest";
import { isSecureEmailActionPath } from "@kartiseret/contracts/public-routes";
import { getOpaqueEmailActionUrl } from "./email-links.js";

describe("opaque secure email action links", () => {
  it.each([
    ["verification", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYSJ9.signature"],
    ["reset", "Abcdefghijklmnopqrstuvwx"],
    ["deletion", "Abcdefghijklmnopqrstuvwx"],
  ] as const)("keeps %s tokens in one URL path segment", (kind, token) => {
    const url = new URL(
      getOpaqueEmailActionUrl(kind, token, "https://seret.site"),
    );
    expect(url.origin).toBe("https://seret.site");
    expect(url.pathname.split("/").filter(Boolean)).toHaveLength(1);
    expect(url.pathname.slice(2)).toBe(token);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("rejects malformed tokens and unsafe origins", () => {
    expect(() =>
      getOpaqueEmailActionUrl("reset", "short", "https://seret.site"),
    ).toThrow("token has an invalid format");
    expect(() =>
      getOpaqueEmailActionUrl(
        "reset",
        "Abcdefghijklmnopqrstuvwx",
        "https://user:password@seret.site",
      ),
    ).toThrow("origin is invalid");
  });

  it("keeps the longest verification link within the site path limit", () => {
    const token = "a".repeat(4094);
    const url = getOpaqueEmailActionUrl(
      "verification",
      token,
      "https://seret.site",
    );

    expect(new URL(url).pathname).toHaveLength(4096);
    expect(isSecureEmailActionPath(new URL(url).pathname)).toBe(true);
    expect(isSecureEmailActionPath(`/E${token}`)).toBe(false);
    expect(() =>
      getOpaqueEmailActionUrl(
        "verification",
        `${token}a`,
        "https://seret.site",
      ),
    ).toThrow("token has an invalid format");
  });
});
