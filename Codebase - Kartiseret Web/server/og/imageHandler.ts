import { socialPreviewImageUrl } from "@kartiseret/contracts/social-preview";
import type { VercelRequest, VercelResponse } from "./vercelTypes.js";
import { getRequestOrigin, safeHttpUrl } from "../seo/renderHtml.js";
import { NO_STORE_CACHE_CONTROL } from "./cacheControl.js";
import { ogRequestQuerySchema } from "./schemas.js";
import { getPreviewData } from "./previewData.js";

/**
 * Compatibility endpoint for previously published `/api/og-image` metadata.
 * New metadata points directly at immutable R2-backed cards; this endpoint
 * only redirects and never renders or downloads an image on demand.
 */
export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  const queryResult = ogRequestQuerySchema.safeParse(request.query);
  if (!queryResult.success) {
    response
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .status(404)
      .send("");
    return;
  }

  if (queryResult.data.home) {
    response
      .setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000")
      .setHeader("Location", `${getRequestOrigin(request.headers)}/og/home.jpg`)
      .status(302)
      .send("");
    return;
  }

  const routeCode = queryResult.data.routeCode;
  if (!routeCode) {
    response
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .status(404)
      .send("");
    return;
  }

  try {
    const data = await getPreviewData(routeCode);
    if (!data) {
      response
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .status(404)
        .send("");
      return;
    }

    const cardUrl =
      (data.socialPreviewFingerprint
        ? socialPreviewImageUrl(
            getRequestOrigin(request.headers),
            data.socialPreviewFingerprint,
          )
        : null) ?? safeHttpUrl(data.posterUrl);
    if (!cardUrl) {
      response
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .status(404)
        .send("");
      return;
    }

    response
      .setHeader("Cache-Control", "public, max-age=300, s-maxage=3600")
      .setHeader("Location", cardUrl)
      .status(302)
      .send("");
  } catch {
    response
      .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
      .status(503)
      .send("");
  }
}
