import { createPreviewImage, downloadImage, MAX_IMAGE_BYTES } from "../server/og/previewImage.ts";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { once } from "node:events";
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
const dispatcher = vercelConfig.functions["api/dispatch.ts"];
assert.ok(dispatcher, "the unified Vercel dispatcher must be configured");
assert.equal(
  Object.keys(vercelConfig.functions).length,
  1,
  "API and OG handlers must share PR2's single dispatcher",
);
assert.equal(typeof dispatcher.includeFiles, "string");
for (const includePattern of [
  "Codebase - Kartiseret Web/dist/**",
  "Codebase - Kartiseret Web/server/og/assets/**",
  "packages/**/dist/**",
]) {
  assert.ok(
    dispatcher.includeFiles.includes(includePattern),
    `the dispatcher must package ${includePattern}`,
  );
}
assert.ok(
  vercelConfig.rewrites.some((rewrite) => rewrite.source === "/api/(.*)"),
  "API paths must reach the dispatcher before the SPA fallback",
);
assert.ok(
  vercelConfig.rewrites.some((rewrite) =>
    rewrite.source.startsWith("/:routeCode")),
  "short links must continue to reach the dispatcher",
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
  const posterPixel = await sharp(previewImage)
    .extract({ left: 200, top: 300, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const backdropPixel = await sharp(previewImage)
    .extract({ left: 1150, top: 590, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const posterLuma =
    posterPixel[0] * 0.2126 + posterPixel[1] * 0.7152 + posterPixel[2] * 0.0722;
  const backdropLuma =
    backdropPixel[0] * 0.2126 +
    backdropPixel[1] * 0.7152 +
    backdropPixel[2] * 0.0722;
  assert.ok(
    posterLuma > backdropLuma + 20,
    "poster artwork must remain brighter than the dimmed backdrop",
  );
} finally {
  globalThis.fetch = originalFetch;
}

const worker = spawn(
  "node",
  [
    "--import",
    "tsx",
    "Codebase - Kartiseret Web/scripts/social-preview-worker.mjs",
  ],
  { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] },
);
const workerLines = createInterface({ input: worker.stdout });
const workerResponses = workerLines[Symbol.asyncIterator]();
async function workerRequest(message) {
  worker.stdin.write(`${JSON.stringify(message)}\n`);
  const response = await workerResponses.next();
  assert.ok(
    !response.done,
    "social preview worker must respond to each request",
  );
  const result = JSON.parse(response.value);
  assert.equal(result.ok, true, result.error);
  return result;
}
try {
  const fingerprint = await workerRequest({
    op: "fingerprint",
    table: "finalMovies",
    record: {
      tmdb_id: 101,
      english_title: "Worker Preview Film",
      release_year: 2026,
      genres: ["Drama"],
      en_poster: "https://image.tmdb.org/t/p/w342/poster.png",
      backdrop: null,
      social_preview_fingerprint: null,
      en_trailer: null,
      solo_update: false,
      alt_options: [],
      imdb_id: null,
      rt_id: null,
      imdbRating: 8,
      imdbVotes: "100",
      rtAudienceRating: "92%",
      rtAudienceVotes: "500",
      rtCriticRating: 80,
      rtCriticVotes: "100",
      lb_id: null,
      lbRating: null,
      lbVotes: null,
      tmdbRating: 75,
      tmdbVotes: "300",
      runtime: 120,
      popularity: 20,
    },
  });
  assert.match(fingerprint.fingerprint, /^[a-f0-9]{64}$/);
  const rendered = await workerRequest({
    op: "render",
    data: fingerprint.data,
    posterSource: fixturePng.toString("base64"),
    backdropSource: fixturePng.toString("base64"),
  });
  const generated = Buffer.from(rendered.jpeg, "base64");
  assert.equal((await sharp(generated).metadata()).format, "jpeg");
  assert.deepEqual(
    {
      width: (await sharp(generated).metadata()).width,
      height: (await sharp(generated).metadata()).height,
    },
    { width: 1200, height: 630 },
  );
} finally {
  worker.stdin.end();
  workerLines.close();
  await once(worker, "exit");
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
    query: { routeCode: "??" },
    headers: { host: "localhost" },
  },
  htmlResponse,
);
assert.equal(htmlResponse.statusCode, 404);
assert.match(htmlResponse.headers.get("content-type"), /^text\/html/);
assert.match(htmlResponse.body, /<h1>Page not found<\/h1>/);

const { default: dispatch } = await import("../../api/dispatch.ts");
const dispatchedResponse = createResponse();
await dispatch(
  {
    url: "/api/dispatch?__vercel_route=movie&routeCode=%3F%3F",
    query: { __vercel_route: "movie", routeCode: "??" },
    headers: { host: "localhost" },
  },
  dispatchedResponse,
);
assert.equal(dispatchedResponse.statusCode, 404);
assert.match(dispatchedResponse.headers.get("content-type"), /^text\/html/);
assert.match(dispatchedResponse.body, /<h1>Page not found<\/h1>/);

const imageResponse = createResponse();
await imageHandler(
  { method: "GET", query: { home: "1" }, headers: { host: "localhost" } },
  imageResponse,
);
assert.equal(imageResponse.statusCode, 302);
assert.equal(
  imageResponse.headers.get("location"),
  "http://localhost/og/home.jpg",
);
const homeImagePath = resolve(webRoot, "public/og/home.jpg");
assert.ok(
  existsSync(homeImagePath),
  "the static homepage social image must exist",
);
assert.equal(
  (await sharp(readFileSync(homeImagePath)).metadata()).format,
  "jpeg",
);

console.log(
  "Built Open Graph handlers, SPA fallback, assets, and JPEG smoke passed.",
);
