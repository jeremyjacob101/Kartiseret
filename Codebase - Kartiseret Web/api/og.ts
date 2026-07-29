import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPreviewData } from "./_lib/previewData";
import { injectOpenGraphTags } from "./_lib/previewHtml";

const indexPath = resolve(process.cwd(), "dist/index.html");
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
    const routeCode = (request.query.routeCode as string | undefined) || "";

    if (!routeCode) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "no-store")
        .send(loadBaseIndexHtml());
      return;
    }

    const previewData = await getPreviewData(routeCode);
    const html = loadBaseIndexHtml();

    if (!previewData) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "no-store")
        .send(html);
      return;
    }

    const ogHtml = injectOpenGraphTags(html, previewData);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(ogHtml);
  } catch (error) {
    console.error("OG handler error:", error);

    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send(loadBaseIndexHtml());
  }
}
