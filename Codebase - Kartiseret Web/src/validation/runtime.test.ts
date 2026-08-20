import { describe, expect, it } from "vitest";
import { z } from "zod";
import { httpUrlSchema, httpsUrlSchema, isoDateStringSchema, longitudeLatitudeSchema, movieCodeSchema, parseJsonWithSchema, parseRuntimeValue, tmdbIdSchema } from "./runtime.js";

describe("runtime boundary schemas", () => {
  it("accepts valid movie codes and rejects malformed route prefixes", () => {
    expect(movieCodeSchema.safeParse("A7z").success).toBe(true);
    expect(movieCodeSchema.safeParse("A7").success).toBe(false);
    expect(movieCodeSchema.safeParse("A-7").success).toBe(false);
  });

  it("normalizes positive TMDB ids without losing string precision", () => {
    expect(tmdbIdSchema.parse(693134)).toBe("693134");
    expect(tmdbIdSchema.parse("900719925474099312345")).toBe(
      "900719925474099312345",
    );
    expect(tmdbIdSchema.safeParse("0").success).toBe(false);
    expect(tmdbIdSchema.safeParse("12.5").success).toBe(false);
  });

  it("checks real ISO calendar dates", () => {
    expect(isoDateStringSchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDateStringSchema.safeParse("2027-02-29").success).toBe(false);
    expect(isoDateStringSchema.safeParse("2027-13-01").success).toBe(false);
  });

  it("distinguishes HTTP origins from HTTPS-only resources", () => {
    expect(httpUrlSchema.parse(" https://seret.site/path ")).toBe(
      "https://seret.site/path",
    );
    expect(httpUrlSchema.safeParse("ftp://seret.site/file").success).toBe(
      false,
    );
    expect(httpUrlSchema.safeParse("https://user@seret.site").success).toBe(
      false,
    );
    expect(
      httpsUrlSchema.safeParse("http://seret.site/image.jpg").success,
    ).toBe(false);
  });

  it("validates longitude-latitude tuples", () => {
    expect(longitudeLatitudeSchema.safeParse([34.78, 32.08]).success).toBe(
      true,
    );
    expect(longitudeLatitudeSchema.safeParse([181, 32.08]).success).toBe(false);
    expect(longitudeLatitudeSchema.safeParse([34.78, Number.NaN]).success).toBe(
      false,
    );
  });

  it("parses JSON only when the decoded value matches its schema", () => {
    const schema = z.array(z.string());
    expect(parseJsonWithSchema('["Drama","Comedy"]', schema)).toEqual([
      "Drama",
      "Comedy",
    ]);
    expect(parseJsonWithSchema('["Drama",4]', schema)).toBeNull();
    expect(parseJsonWithSchema("not json", schema)).toBeNull();
  });

  it("throws contextual errors for invalid trusted-boundary parsing", () => {
    expect(() =>
      parseRuntimeValue(
        z.object({ id: tmdbIdSchema }),
        { id: null },
        "fixture",
      )).toThrow(/Invalid fixture runtime data/);
  });
});
