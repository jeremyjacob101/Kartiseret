import { describe, expect, it } from "vitest";
import { parseLetterboxdSourceUrl } from "./letterboxd-source-url.js";

describe("parseLetterboxdSourceUrl", () => {
  it("normalizes a bare public boxd.it list link", () => {
    expect(parseLetterboxdSourceUrl("https://boxd.it/Y9Hce")).toEqual({
      sourceUrl: "https://boxd.it/Y9Hce/",
      sourceType: "list",
    });
  });

  it("continues to normalize link-visible share links", () => {
    expect(
      parseLetterboxdSourceUrl("https://boxd.it/abc123$testShareToken_1"),
    ).toEqual({
      sourceUrl: "https://boxd.it/abc123$testShareToken_1/",
      sourceType: "list",
    });
  });

  it("rejects boxd.it paths that are not public or share short links", () => {
    expect(() => parseLetterboxdSourceUrl("https://boxd.it/abc123$")).toThrow(
      /public Letterboxd watchlist or list URL/,
    );
  });
});
