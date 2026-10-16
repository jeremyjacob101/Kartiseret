import { describe, expect, it, vi } from "vitest";
import {
  createVercelDispatchHandler,
  type VercelDispatchRequest,
  type VercelDispatchResponse,
} from "./vercel-dispatch.js";

function createRequest(url: string): VercelDispatchRequest {
  const requestUrl = new URL(url, "https://kartiseret.example");
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of requestUrl.searchParams) {
    const existingValue = query[key];
    query[key] = existingValue
      ? Array.isArray(existingValue)
        ? [...existingValue, value]
        : [existingValue, value]
      : value;
  }

  return {
    headers: {},
    query,
    url: `${requestUrl.pathname}${requestUrl.search}`,
  };
}

const response = {} as VercelDispatchResponse;

function createHandlers() {
  return {
    api: vi.fn(),
    og: vi.fn(),
    ogImage: vi.fn(),
  };
}

describe("Vercel API dispatcher", () => {
  it("restores the original API path and preserves the query string", async () => {
    const handlers = createHandlers();
    const dispatch = createVercelDispatchHandler(handlers);
    const request = createRequest(
      "/api/dispatch?__vercel_route=v1%2Fcatalog%2Fnow-playing&fromDate=2026-10-16",
    );

    await dispatch(request, response);

    expect(request.url).toBe("/api/v1/catalog/now-playing?fromDate=2026-10-16");
    expect(request.query.__vercel_route).toBeUndefined();
    expect(request.query.fromDate).toBe("2026-10-16");
    expect(handlers.api).toHaveBeenCalledWith(request, response);
    expect(handlers.og).not.toHaveBeenCalled();
    expect(handlers.ogImage).not.toHaveBeenCalled();
  });

  it("sends OG HTML and image paths to their dedicated handlers", async () => {
    const handlers = createHandlers();
    const dispatch = createVercelDispatchHandler(handlers);
    const ogRequest = createRequest(
      "/api/dispatch?__vercel_route=og&routeCode=Ab1",
    );
    const imageRequest = createRequest(
      "/api/dispatch?__vercel_route=og-image&home=1",
    );

    await dispatch(ogRequest, response);
    await dispatch(imageRequest, response);

    expect(ogRequest.url).toBe("/api/og?routeCode=Ab1");
    expect(ogRequest.query.routeCode).toBe("Ab1");
    expect(handlers.og).toHaveBeenCalledWith(ogRequest, response);
    expect(imageRequest.url).toBe("/api/og-image?home=1");
    expect(imageRequest.query.home).toBe("1");
    expect(handlers.ogImage).toHaveBeenCalledWith(imageRequest, response);
  });

  it("routes unknown API paths through Express and rejects unsafe path captures", async () => {
    const handlers = createHandlers();
    const dispatch = createVercelDispatchHandler(handlers);
    const unknownRequest = createRequest(
      "/api/dispatch?__vercel_route=not-a-route",
    );
    const invalidRequest = createRequest(
      "/api/dispatch?__vercel_route=..%2Fsecret",
    );

    await dispatch(unknownRequest, response);
    await dispatch(invalidRequest, response);

    expect(unknownRequest.url).toBe("/api/not-a-route");
    expect(invalidRequest.url).toBe("/api/dispatch");
    expect(handlers.api).toHaveBeenNthCalledWith(1, unknownRequest, response);
    expect(handlers.api).toHaveBeenNthCalledWith(2, invalidRequest, response);
  });
});
