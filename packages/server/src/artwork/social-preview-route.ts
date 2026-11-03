import type { RequestHandler } from "express";
import type { R2ImageStore } from "./s3.js";

const MAX_SOCIAL_PREVIEW_BYTES = 2 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const IMMUTABLE_CDN_CACHE_CONTROL = "public, s-maxage=31536000, immutable";

export function createSocialPreviewImageHandler(
  store: R2ImageStore | null,
): RequestHandler {
  return async (request, response) => {
    const param = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    const version = param(request.params.version);
    const fingerprint = param(request.params.fingerprint);
    const filename = param(request.params.filename);

    if (
      version !== "v1" ||
      filename !== "card.jpg" ||
      !/^[a-f0-9]{64}$/.test(fingerprint ?? "")
    ) {
      response.setHeader("Cache-Control", "no-store").status(404).end();
      return;
    }
    if (!store) {
      response.setHeader("Cache-Control", "no-store").status(503).end();
      return;
    }

    try {
      const object = await store.getObject(
        `social/${version}/${fingerprint}/card.jpg`,
      );
      if (object.status === 404) {
        response.setHeader("Cache-Control", "no-store").status(404).end();
        return;
      }
      if (!object.ok || !object.body) {
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      if (object.headers.get("content-type") !== "image/jpeg") {
        await object.body.cancel();
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      const contentLengthHeader = object.headers.get("content-length");
      const contentLength =
        contentLengthHeader === null ? null : Number(contentLengthHeader);
      if (
        contentLength !== null &&
        (!Number.isSafeInteger(contentLength) || contentLength < 0)
      ) {
        await object.body.cancel();
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      if (contentLength !== null && contentLength > MAX_SOCIAL_PREVIEW_BYTES) {
        await object.body.cancel();
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }

      const reader = object.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_SOCIAL_PREVIEW_BYTES) {
          await reader.cancel();
          response.setHeader("Cache-Control", "no-store").status(502).end();
          return;
        }
        chunks.push(value);
      }

      if (
        total < 3 ||
        (contentLength !== null && contentLength !== total) ||
        chunks[0]?.[0] !== 0xff ||
        chunks[0]?.[1] !== 0xd8 ||
        chunks[0]?.[2] !== 0xff
      ) {
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }

      response
        .setHeader("Content-Type", "image/jpeg")
        .setHeader("X-Content-Type-Options", "nosniff")
        .setHeader("Cache-Control", IMMUTABLE_CACHE_CONTROL)
        .setHeader("CDN-Cache-Control", IMMUTABLE_CDN_CACHE_CONTROL)
        .setHeader("Vercel-CDN-Cache-Control", IMMUTABLE_CDN_CACHE_CONTROL)
        .status(200)
        .send(
          Buffer.concat(
            chunks.map((chunk) => Buffer.from(chunk)),
            total,
          ),
        );
    } catch {
      response.setHeader("Cache-Control", "no-store").status(502).end();
    }
  };
}
