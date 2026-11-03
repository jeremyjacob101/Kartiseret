import { NO_STORE_CACHE_CONTROL, PREVIEW_CACHE_CONTROL } from "./cacheControl.js";
import { getPreviewData, resolvePreviewRouteSelection } from "./previewData.js";
import type { VercelRequest, VercelResponse } from "./vercelTypes.js";
import { injectOpenGraphTags } from "./previewHtml.js";
import { ogRequestQuerySchema } from "./schemas.js";
import { SITE_ORIGIN } from "../seo/renderHtml.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const indexPath = resolve(
  process.cwd(),
  "Codebase - Kartiseret Web/dist/index.html",
);
let baseIndexHtml: string | null = null;

function loadBaseIndexHtml(): string {
  if (baseIndexHtml) {
    return baseIndexHtml;
  }

  try {
    baseIndexHtml = readFileSync(indexPath, "utf8");
  } catch {
    baseIndexHtml =
      "<!DOCTYPE html><html><head><title>Kartiseret</title></head><body></body></html>";
  }

  return baseIndexHtml;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  try {
    const queryResult = ogRequestQuerySchema.safeParse(request.query);
    const routeCode = queryResult.success ? queryResult.data.routeCode : "";
    const hasRouteCode = request.query.routeCode !== undefined;

    if (!routeCode) {
      if (hasRouteCode) {
        response
          .status(404)
          .setHeader("Content-Type", "text/html; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
          .send(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Page not found | Kartiseret</title></head><body><main><h1>Page not found</h1><a href="/">Return to Kartiseret</a></main></body></html>',
          );
        return;
      }
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(loadBaseIndexHtml());
      return;
    }

    if (!resolvePreviewRouteSelection(routeCode)) {
      response
        .status(404)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("X-Robots-Tag", "noindex, nofollow")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Page not found | Kartiseret</title></head><body><main><h1>Page not found</h1><p>This movie page is not available.</p><a href="/">Return to Kartiseret</a></main></body></html>',
        );
      return;
    }

    const previewData = await getPreviewData(routeCode);
    const html = loadBaseIndexHtml();

    if (!previewData) {
      response
        .status(404)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("X-Robots-Tag", "noindex, nofollow")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Page not found | Kartiseret</title></head><body><main><h1>Page not found</h1><p>This movie page is not available.</p><a href="/">Return to Kartiseret</a></main></body></html>',
        );
      return;
    }

    const ogHtml = injectOpenGraphTags(html, previewData, SITE_ORIGIN);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader(
        "X-Robots-Tag",
        process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
          ? "noindex, nofollow"
          : "index, follow",
      )
      .setHeader("Cache-Control", PREVIEW_CACHE_CONTROL)
      .send(ogHtml);
  } catch (error) {
    console.error("OG handler error:", error);

    response
      .status(503)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .send("Movie preview temporarily unavailable.");
  }
}
