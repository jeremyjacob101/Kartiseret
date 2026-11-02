import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("../vercel.json", "utf8"));

describe("deployment performance boundaries", () => {
  it("runs the existing API in Frankfurt", () => {
    expect(config.regions).toEqual(["fra1"]);
    expect(Object.keys(config.functions)).toEqual(["api/dispatch.ts"]);
  });

  it("applies immutable caching to hashed JS/CSS without caching HTML, APIs or unhashed files", () => {
    const rules = config.headers as {
      source: string;
      headers: { key: string; value: string }[];
    }[];
    const cacheHeader = (path: string) =>
      rules
        .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
        .flatMap((rule) => rule.headers)
        .find((header) => header.key === "Cache-Control")?.value;
    for (const path of [
      "/assets/index-BKBcw25X.js",
      "/assets/index-DKgx18eK.css",
      "/assets/maplibre-gl-worker-rAGZGcJB.js",
    ])
      expect(cacheHeader(path)).toBe("public, max-age=31536000, immutable");
    for (const path of [
      "/",
      "/index.html",
      "/api/v1/catalog/now-playing",
      "/api/auth/get-session",
      "/logos/kartiseret1.svg",
      "/assets/index.js",
      "/assets/index.css",
      "/assets/image-BKBcw25X.png",
      "/assets/index-BKBcw25X.js.map",
    ])
      expect(cacheHeader(path)).toBeUndefined();
  });
});
