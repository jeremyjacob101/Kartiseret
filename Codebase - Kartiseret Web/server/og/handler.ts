import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NO_STORE_CACHE_CONTROL, PREVIEW_CACHE_CONTROL } from "./cacheControl.js";
import { getPreviewData } from "./previewData.js";
import { injectOpenGraphTags, injectPreviewCrawlerFavicon } from "./previewHtml.js";

const PREVIEW_CRAWLER_USER_AGENT = /WhatsApp|facebookexternalhit|Facebot/i;

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

function loadRequestIndexHtml(request: VercelRequest): string {
  const userAgent = request.headers["user-agent"];
  const userAgentText = Array.isArray(userAgent)
    ? userAgent.join(" ")
    : userAgent || "";
  const html = loadBaseIndexHtml();

  return PREVIEW_CRAWLER_USER_AGENT.test(userAgentText)
    ? injectPreviewCrawlerFavicon(html)
    : html;
}

function deriveSiteOrigin(request: VercelRequest): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader)
    ? protoHeader[0]
    : protoHeader || "https";

  const hostHeader =
    request.headers["x-forwarded-host"] || request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;

  if (host) {
    return `${proto}://${host}`.replace(/\/+$/, "");
  }

  return (process.env.SITE_URL || "https://seret.site").replace(/\/$/, "");
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  response.setHeader("Vary", "User-Agent");

  try {
    const routeCode = (request.query.routeCode as string | undefined) || "";
    const html = loadRequestIndexHtml(request);

    if (!routeCode) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(html);
      return;
    }

    const previewData = await getPreviewData(routeCode);

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
    const html = loadRequestIndexHtml(request);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .send(html);
  }
}
