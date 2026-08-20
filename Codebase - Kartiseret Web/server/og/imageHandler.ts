import type { VercelRequest, VercelResponse } from "@vercel/node";
import { NO_STORE_CACHE_CONTROL, PREVIEW_CACHE_CONTROL } from "./cacheControl.js";
import { getPreviewData } from "./previewData.js";
import { createPreviewImage, createHomepagePreviewImage } from "./previewImage.js";
import { ogRequestQuerySchema } from "./schemas.js";

const FALLBACK_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAIABQADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRFJiMkVic4EzQjR0RSlFNkVUcCZS/9oADABEAAxEB/9qAP/9k=",
  "base64",
);

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  try {
    const queryResult = ogRequestQuerySchema.safeParse(request.query);
    const routeCode = queryResult.success ? queryResult.data.routeCode : "";
    const isHome = queryResult.success && queryResult.data.home;

    if (isHome) {
      const image = await createHomepagePreviewImage();
      response
        .status(200)
        .setHeader("Content-Type", "image/jpeg")
        .setHeader("Cache-Control", PREVIEW_CACHE_CONTROL)
        .send(image);
      return;
    }

    if (!routeCode) {
      response
        .status(404)
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send("Not found");
      return;
    }

    const previewData = await getPreviewData(routeCode);

    if (!previewData) {
      response
        .status(404)
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send("Not found");
      return;
    }

    const image = await createPreviewImage(previewData);

    response
      .status(200)
      .setHeader("Content-Type", "image/jpeg")
      .setHeader("Cache-Control", PREVIEW_CACHE_CONTROL)
      .send(image);
  } catch (error) {
    console.error("OG image handler error:", error);

    try {
      const fallback = await createHomepagePreviewImage();
      response
        .status(200)
        .setHeader("Content-Type", "image/jpeg")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(fallback);
    } catch {
      response
        .status(200)
        .setHeader("Content-Type", "image/jpeg")
        .setHeader("Cache-Control", NO_STORE_CACHE_CONTROL)
        .send(FALLBACK_JPEG);
    }
  }
}
