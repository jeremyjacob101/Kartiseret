import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { httpUrlSchema } from "../../src/validation/runtime.js";
import { NO_STORE_CACHE_CONTROL, PREVIEW_CACHE_CONTROL } from "./cacheControl.js";
import { getPreviewData } from "./previewData.js";
import { injectOpenGraphTags } from "./previewHtml.js";
import { ogRequestQuerySchema } from "./schemas.js";

const indexPath = resolve(
  process.cwd(),
  "Codebase - Kartiseret Web/dist/index.html",
);
let baseIndexHtml: string | null = null;
const requestHeaderSchema = z
  .union([z.string(), z.array(z.string()).min(1)])
  .transform((value) => (Array.isArray(value) ? value[0] : value))
  .pipe(z.string().trim().min(1).max(255));
const forwardedProtocolSchema = z.enum(["http", "https"]);

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

function deriveSiteOrigin(request: VercelRequest): string {
  const protocolResult = requestHeaderSchema
    .pipe(forwardedProtocolSchema)
    .safeParse(request.headers["x-forwarded-proto"]);
  const hostResult = requestHeaderSchema.safeParse(
    request.headers["x-forwarded-host"] ?? request.headers.host,
  );
  const requestOriginResult = hostResult.success
    ? httpUrlSchema.safeParse(
        `${protocolResult.success ? protocolResult.data : "https"}://${hostResult.data}`,
      )
    : null;

  if (requestOriginResult?.success) {
    return new URL(requestOriginResult.data).origin;
  }

  const configuredOriginResult = httpUrlSchema.safeParse(
    process.env.SITE_URL ?? "https://seret.site",
  );
  return configuredOriginResult.success
    ? new URL(configuredOriginResult.data).origin
    : "https://seret.site";
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  try {
    const queryResult = ogRequestQuerySchema.safeParse(request.query);
    const routeCode = queryResult.success ? queryResult.data.routeCode : "";

    if (!routeCode) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(loadBaseIndexHtml());
      return;
    }

    const previewData = await getPreviewData(routeCode);
    const html = loadBaseIndexHtml();

    if (!previewData) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(html);
      return;
    }

    const siteOrigin = deriveSiteOrigin(request);
    const ogHtml = injectOpenGraphTags(html, previewData, siteOrigin);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", PREVIEW_CACHE_CONTROL)
      .send(ogHtml);
  } catch (error) {
    console.error("OG handler error:", error);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .send(loadBaseIndexHtml());
  }
}
