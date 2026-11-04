import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPreviewData: vi.fn() }));
vi.mock("../../server/og/previewData.js", () => ({
  getPreviewData: mocks.getPreviewData,
}));

import imageHandler from "../../server/og/imageHandler.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe("legacy Open Graph image compatibility endpoint", () => {
  beforeEach(() => mocks.getPreviewData.mockReset());

  it("redirects movie links to the current immutable card without rendering", async () => {
    const fingerprint = "a".repeat(64);
    mocks.getPreviewData.mockResolvedValue({
      socialPreviewFingerprint: fingerprint,
      posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
    });
    const response = createResponse();

    await imageHandler(
      {
        query: { routeCode: "Ab1abc" },
        headers: { host: "kartiseret-dev.vercel.app" },
      },
      response,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://kartiseret-dev.vercel.app/api/images/social/v1/${fingerprint}/card.jpg`,
    );
    expect(response.body).toBe("");
  });

  it("redirects homepage requests to the static home image", async () => {
    const response = createResponse();

    await imageHandler(
      { query: { home: "1" }, headers: { host: "localhost:5173" } },
      response,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:5173/og/home.jpg",
    );
    expect(mocks.getPreviewData).not.toHaveBeenCalled();
  });

  it("falls back to a poster until the static card is ready and returns uncached errors", async () => {
    mocks.getPreviewData
      .mockResolvedValueOnce({
        posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
      })
      .mockResolvedValueOnce(null);
    const fallbackResponse = createResponse();
    await imageHandler(
      { query: { routeCode: "Ab1abc" }, headers: { host: "seret.site" } },
      fallbackResponse,
    );
    expect(fallbackResponse.headers.get("location")).toBe(
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );

    const missingResponse = createResponse();
    await imageHandler(
      { query: { routeCode: "Ab1abc" }, headers: { host: "seret.site" } },
      missingResponse,
    );
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.headers.get("cache-control")).toBe("no-store");
  });
});
