import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPreviewData: vi.fn(),
  resolvePreviewRouteSelection: vi.fn(),
}));

vi.mock("../server/og/previewData.js", () => mocks);
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync: () =>
    '<!doctype html><html lang="en"><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><div id="seo-content"></div><!-- SEO_CONTENT_END --><div id="root"></div></body></html>',
}));

const { default: handler } = await import("../server/og/handler.js");

function createResponse() {
  const response = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: unknown) {
      this.body = String(body);
      return this;
    },
  };
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePreviewRouteSelection.mockImplementation((routeCode: string) =>
    routeCode === "??" ? null : { movieCode: routeCode.slice(0, 3) });
});

describe("Open Graph HTML handler", () => {
  it("keeps the base HTML response for the no-code fallback", async () => {
    const response = createResponse();
    await handler({ query: {}, headers: {} } as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an uncached noindex 404 for an unknown movie code", async () => {
    mocks.getPreviewData.mockResolvedValue(null);
    const response = createResponse();
    await handler(
      { query: { routeCode: "Ab1" }, headers: {} } as never,
      response as never,
    );

    expect(response.statusCode).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.body).toContain("Page not found");
  });

  it("rejects malformed short codes without initializing the database", async () => {
    const response = createResponse();
    await handler(
      { query: { routeCode: "??" }, headers: {} } as never,
      response as never,
    );

    expect(response.statusCode).toBe(404);
    expect(mocks.getPreviewData).not.toHaveBeenCalled();
  });

  it("returns a temporary server error when preview data fails", async () => {
    mocks.getPreviewData.mockRejectedValue(new Error("database unavailable"));
    const response = createResponse();
    await handler(
      { query: { routeCode: "Ab1" }, headers: {} } as never,
      response as never,
    );

    expect(response.statusCode).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.body).toBe("Movie preview temporarily unavailable.");
  });
});
