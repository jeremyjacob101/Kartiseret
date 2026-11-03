import type { RequestHandler } from "express";
import type { R2ImageStore } from "./s3.js";

const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;

const allowed = {
  poster: new Set([185, 342, 780]),
  backdrop: new Set([780, 1280]),
} as const;

export function createArtworkHandler(
  store: R2ImageStore | null,
): RequestHandler {
  return async (request, response) => {
    const param = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;
    const version = param(request.params.version);
    const kind = param(request.params.kind);
    const hash = param(request.params.hash);
    const filename = param(request.params.filename);
    const width = /^(\d+)\.webp$/.exec(filename ?? "")?.[1];
    const numberWidth = width ? Number(width) : 0;
    const allowedWidths =
      kind === "poster"
        ? allowed.poster
        : kind === "backdrop"
          ? allowed.backdrop
          : undefined;
    if (
      version !== "v1" ||
      !allowedWidths ||
      !/^[a-f0-9]{64}$/.test(hash ?? "") ||
      !numberWidth ||
      width !== String(numberWidth) ||
      !allowedWidths.has(numberWidth)
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
        `artwork/${version}/${kind}/${hash}/${numberWidth}.webp`,
      );
      if (object.status === 404) {
        response.setHeader("Cache-Control", "no-store").status(404).end();
        return;
      }
      if (!object.ok || !object.body) {
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      if (object.headers.get("content-type") !== "image/webp") {
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      const declaredContentLength = object.headers.get("content-length");
      const declaredLength =
        declaredContentLength === null ? null : Number(declaredContentLength);
      if (
        declaredLength !== null &&
        (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
      ) {
        await object.body.cancel();
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      if (declaredLength !== null && declaredLength > MAX_ARTWORK_BYTES) {
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
        if (total > MAX_ARTWORK_BYTES) {
          await reader.cancel();
          response.setHeader("Cache-Control", "no-store").status(502).end();
          return;
        }
        chunks.push(value);
      }
      if (
        total === 0 ||
        (declaredLength !== null && declaredLength !== total)
      ) {
        response.setHeader("Cache-Control", "no-store").status(502).end();
        return;
      }
      response.setHeader("Content-Type", "image/webp");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "public, max-age=86400");
      response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=86400");
      response.setHeader("CDN-Cache-Control", "public, max-age=86400");
      response.status(200).send(
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
