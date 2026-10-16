import { createPreviewImage, downloadImage, MAX_IMAGE_BYTES } from "../server/og/previewImage.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(webRoot, "..");
process.chdir(repositoryRoot);

const indexPath = resolve(
  repositoryRoot,
  "Codebase - Kartiseret Web/dist/index.html",
);
assert.ok(existsSync(indexPath), "the built SPA index must be present");
assert.ok(
  existsSync(resolve(webRoot, "server/og/assets/Inter-Bold.ttf")),
  "the Open Graph font assets must be present",
);

const vercelConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, "vercel.json"), "utf8"),
);
for (const functionName of ["api/og.ts", "api/og-image.ts"]) {
  const includes = vercelConfig.functions[functionName].includeFiles;
  assert.ok(
    Array.isArray(includes),
    `${functionName} must declare packaged files`,
  );
  assert.ok(includes.includes("packages/server/dist/**"));
  assert.ok(includes.includes("packages/contracts/dist/**"));
}
assert.ok(
  vercelConfig.functions["api/og-image.ts"].includeFiles.includes(
    "Codebase - Kartiseret Web/server/og/assets/**",
  ),
);

const { default: htmlHandler } = await import("../server/og/handler.ts");
const { default: imageHandler } = await import("../server/og/imageHandler.ts");

const previewData = {
  routeCode: "Ab1",
  movieCode: "Ab1",
  tmdbId: "101",
  title: "Preview Test Movie",
  city: "Jerusalem",
  date: "2026-09-16",
  dateLabel: "Wednesday, Sep 16",
  posterUrl: "https://images.example/poster.png",
  backdropUrl: "https://images.example/backdrop.png",
  isComingSoon: false,
  theaters: [],
  year: 2026,
  releaseDate: null,
  runtime: 120,
  genres: ["Drama"],
  imdbRating: 8,
  rtCriticRating: null,
  rtCriticVotes: null,
  rtAudienceRating: null,
  rtAudienceVotes: null,
  lbRating: null,
};

const fixturePng = await sharp({
  create: {
    width: 12,
    height: 12,
    channels: 4,
    background: "#563d7c",
  },
})
  .png()
  .toBuffer();
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/backdrop.png")) {
      return new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response(fixturePng, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(fixturePng.byteLength),
      },
    });
  };
  const previewImage = await createPreviewImage(previewData);
  const previewImageMetadata = await sharp(previewImage).metadata();
  assert.deepEqual(
    {
      format: previewImageMetadata.format,
      width: previewImageMetadata.width,
      height: previewImageMetadata.height,
    },
    { format: "jpeg", width: 1200, height: 630 },
  );
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(
  await downloadImage("http://images.example/poster.png", async () => {
    throw new Error("Insecure URLs must not be fetched.");
  }),
  null,
);
assert.equal(
  await downloadImage(
    "https://images.example/large.png",
    async () =>
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(MAX_IMAGE_BYTES + 1),
        },
      }),
  ),
  null,
);

function createResponse() {
  return {
    statusCode: 200,
    headers: new Map(),
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

const htmlResponse = createResponse();
await htmlHandler(
  {
    method: "GET",
    query: { routeCode: "broken" },
    headers: { host: "localhost" },
  },
  htmlResponse,
);
assert.equal(htmlResponse.statusCode, 200);
assert.match(htmlResponse.headers.get("content-type"), /^text\/html/);
assert.match(htmlResponse.body, /<div id="root"><\/div>/);

const imageResponse = createResponse();
await imageHandler(
  { method: "GET", query: { home: "1" }, headers: { host: "localhost" } },
  imageResponse,
);
assert.equal(imageResponse.statusCode, 200);
assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
assert.ok(Buffer.isBuffer(imageResponse.body));
assert.equal((await sharp(imageResponse.body).metadata()).format, "jpeg");

console.log(
  "Built Open Graph handlers, SPA fallback, assets, and JPEG smoke passed.",
);
