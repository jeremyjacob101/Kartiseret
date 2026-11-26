import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("../vercel.json", "utf8"));
const appleAssociation = JSON.parse(
  readFileSync("public/apple-app-site-association", "utf8"),
) as {
  applinks: {
    details: { appIDs: string[]; components: Record<string, unknown>[] }[];
  };
};

describe("deployment performance boundaries", () => {
  it("does not register obsolete /c cinema URLs in rewrites or app links", () => {
    const rewrites = config.rewrites as {
      source: string;
      destination: string;
    }[];
    const components = appleAssociation.applinks.details[0]?.components ?? [];

    expect(
      rewrites.some(
        ({ source, destination }) =>
          source === "/c/:cinemaId" ||
          source.startsWith("/c/") ||
          destination.includes("/c/"),
      ),
    ).toBe(false);
    expect(
      components.some((component) => {
        const path = component["/"];
        return (
          typeof path === "string" &&
          (path === "/c/*" || path.startsWith("/c/"))
        );
      }),
    ).toBe(false);
  });

  it("serves a scoped Apple Universal Links association for the native app", () => {
    const association = appleAssociation.applinks.details[0];
    expect(association?.appIDs).toEqual(["UZ7YLA6V9D.com.jj.kartiseret"]);
    const components = association?.components ?? [];
    expect(components).toContainEqual(
      expect.objectContaining({ "#": "no_universal_links", exclude: true }),
    );
    for (const path of ["/????????"]) {
      expect(components).toContainEqual(expect.objectContaining({ "/": path }));
    }
    expect(components).not.toContainEqual(
      expect.objectContaining({ "/": "/c/*" }),
    );
    for (const path of [
      "/reset-password",
      "/unsubscribe/letterboxd",
      "/attribution",
    ]) {
      expect(components).not.toContainEqual(
        expect.objectContaining({ "/": path }),
      );
    }
    expect(components).toContainEqual(
      expect.objectContaining({ "/": "/api", exclude: true }),
    );
    expect(components).toContainEqual(
      expect.objectContaining({ "/": "/api/*", exclude: true }),
    );
    const rewriteIndex = config.rewrites.findIndex(
      (rewrite: { source: string }) =>
        rewrite.source === "/.well-known/apple-app-site-association",
    );
    expect(rewriteIndex).toBeGreaterThanOrEqual(0);
    expect(rewriteIndex).toBeLessThan(config.rewrites.length - 1);
    expect(config.rewrites[rewriteIndex]?.destination).toBe(
      "/apple-app-site-association",
    );
    const headers = config.headers.find(
      (rule: { source: string }) =>
        rule.source === "/.well-known/apple-app-site-association",
    )?.headers;
    expect(headers).toContainEqual({
      key: "Content-Type",
      value: "application/json",
    });
  });

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

  it("routes SEO endpoints and opaque codes before the not-found fallback", () => {
    const rewrites = config.rewrites as {
      source: string;
      destination: string;
      has?: unknown;
    }[];
    const indexOf = (source: string) =>
      rewrites.findIndex((rewrite) => rewrite.source === source);
    for (const source of [
      "/index.html",
      "/third-party-licenses.txt",
      "/robots.txt",
      "/sitemap.xml",
      "/movies",
      "/showtimes",
      "/soons",
      "/cinematheques",
      "/reset-password",
      "/confirm-account-deletion",
      "/unsubscribe/letterboxd",
    ]) {
      expect(indexOf(source), `${source} rewrite`).toBeGreaterThanOrEqual(0);
    }
    expect(indexOf("/reset-password")).toBeLessThan(
      indexOf("/:routeCode([a-z0-9]{8})"),
    );
    expect(indexOf("/index.html")).toBeLessThan(
      indexOf("/:routeCode([a-z0-9]{8})"),
    );
    expect(indexOf("/third-party-licenses.txt")).toBeLessThan(
      indexOf("/:routeCode([a-z0-9]{8})"),
    );
    expect(indexOf("/unsubscribe/letterboxd")).toBeLessThan(
      indexOf("/:routeCode([a-z0-9]{8})"),
    );
    for (const source of [
      "/support",
      "/accessibility",
      "/privacy",
      "/terms",
      "/attribution",
    ]) {
      expect(indexOf(source)).toBeGreaterThanOrEqual(0);
      expect(indexOf(source)).toBeLessThan(indexOf("/:routeCode([a-z0-9]{8})"));
      expect(
        rewrites.find((rewrite) => rewrite.source === source)?.destination,
      ).toBe(`/api/dispatch?__vercel_route=page&path=${source}`);
    }
    expect(indexOf("/(.*)")).toBe(rewrites.length - 1);
    expect(indexOf("/c/:cinemaId")).toBe(-1);
    expect(rewrites.some((rewrite) => rewrite.source.includes("/c/"))).toBe(
      false,
    );
    expect(
      rewrites.some((rewrite) => rewrite.destination.includes("/c/")),
    ).toBe(false);
    expect(
      rewrites.find((rewrite) => rewrite.source === "/api")?.destination,
    ).toBe("/api/dispatch");
    expect(
      rewrites.find((rewrite) => rewrite.source === "/reset-password")
        ?.destination,
    ).toBe("/api/dispatch?__vercel_route=page&path=/reset-password");
    expect(
      rewrites.find(
        (rewrite) => rewrite.source === "/index.html" && !rewrite.has,
      )?.destination,
    ).toBe("/api/dispatch?__vercel_route=page&path=/");
    expect(
      rewrites.find((rewrite) => rewrite.source === "/third-party-licenses.txt")
        ?.destination,
    ).toBe("/api/dispatch?__vercel_route=page&path=/third-party-licenses.txt");
    expect(
      rewrites.find((rewrite) => rewrite.source === "/unsubscribe/letterboxd")
        ?.destination,
    ).toBe("/index.html");
    expect(
      rewrites.find((rewrite) => rewrite.source === "/sitemap.xml")
        ?.destination,
    ).toContain("__vercel_route=sitemap");
    expect(
      rewrites.find((rewrite) => rewrite.source === "/robots.txt")?.destination,
    ).toContain("__vercel_route=robots");
  });

  it("routes the root through SSR before Vercel can serve the static index file", () => {
    const routes = config.routes as {
      src: string;
      dest: string;
      has?: { type: string; key: string; value: string }[];
    }[];
    const [privateRoute, rootRoute] = routes.filter(
      (route) => route.src === "^/$",
    );
    const privateIndexRoute = routes.find(
      (route) => route.src === "^/index\\.html$" && route.has,
    );
    const indexRoute = routes.find(
      (route) => route.src === "^/index\\.html$" && !route.has,
    );
    const licenseRoute = routes.find(
      (route) => route.src === "^/third-party-licenses\\.txt$",
    );

    expect(rootRoute?.dest).toBe("/api/dispatch?__vercel_route=page&path=/");
    expect(rootRoute?.has).toBeUndefined();
    expect(privateIndexRoute?.dest).toBe(
      "/api/dispatch?__vercel_route=private-page&path=/",
    );
    expect(indexRoute?.dest).toBe("/api/dispatch?__vercel_route=page&path=/");
    expect(licenseRoute?.dest).toBe(
      "/api/dispatch?__vercel_route=page&path=/third-party-licenses.txt",
    );
    expect(privateRoute?.dest).toBe(
      "/api/dispatch?__vercel_route=private-page&path=/",
    );
    const [cookieCondition] = privateRoute?.has ?? [];
    expect(cookieCondition).toMatchObject({ type: "header", key: "cookie" });
    const matches = new RegExp(`^(?:${cookieCondition?.value})$`);
    expect(
      matches.test(
        "unrelated=1; __Secure-kartiseret-production.session_token=opaque; other=1",
      ),
    ).toBe(true);
    expect(matches.test("kartiseret-preview.session_token=opaque")).toBe(true);
    expect(
      matches.test("other=kartiseret-production.session_token=opaque"),
    ).toBe(false);
  });

  it("blocks framing across static and server-rendered routes", () => {
    const headerRules = config.headers as {
      source: string;
      headers: { key: string; value: string }[];
    }[];
    for (const path of [
      "/",
      "/movies",
      "/user",
      "/reset-password",
      "/confirm-account-deletion",
      "/unsubscribe/letterboxd",
    ]) {
      const policies = headerRules
        .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
        .flatMap((rule) => rule.headers)
        .filter(
          (header) => header.key.toLowerCase() === "content-security-policy",
        );
      expect(policies, path).toEqual([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ]);
    }
  });

  it("marks account and reset pages as non-indexable in initial HTTP responses", () => {
    const headerRules = config.headers as {
      source: string;
      headers: { key: string; value: string }[];
    }[];
    for (const path of [
      "/user",
      "/reset-password",
      "/confirm-account-deletion",
      "/support",
      "/accessibility",
      "/privacy",
      "/terms",
      "/attribution",
      "/unsubscribe/letterboxd",
    ]) {
      const robots = headerRules
        .find((rule) => rule.source === path)
        ?.headers.find((header) => header.key.toLowerCase() === "x-robots-tag");
      expect(robots?.value).toBe("noindex, nofollow");
    }
    for (const path of [
      "/reset-password",
      "/confirm-account-deletion",
      "/unsubscribe/letterboxd",
    ]) {
      const headers = headerRules.find((rule) => rule.source === path)?.headers;
      expect(headers).toContainEqual({
        key: "Referrer-Policy",
        value: "no-referrer",
      });
      expect(headers).toContainEqual({
        key: "Cache-Control",
        value: "no-store",
      });
    }
  });
});

it("serves the emailed deletion confirmation as an application route", () => {
  expect(
    config.rewrites.find(
      (rewrite: { source: string; destination: string }) =>
        rewrite.source === "/confirm-account-deletion",
    )?.destination,
  ).toBe("/index.html");
});
