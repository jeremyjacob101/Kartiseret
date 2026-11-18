import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const [origin, label, iterations, ...routes] = process.argv.slice(2);
const count = Number(iterations);
if (
  !origin ||
  !label ||
  !Number.isInteger(count) ||
  count < 1 ||
  routes.length === 0 ||
  routes.some((route) => !route.startsWith("/") || route.startsWith("//"))
) {
  throw new Error(
    "Usage: node scripts/measure-public-pages.mjs ORIGIN BUILD COUNT /path [/path...]",
  );
}
const base = new URL(origin);
const runCurl = promisify(execFile);
const previewCookieFile = process.env.KARTISERET_MEASURE_COOKIE_FILE;
const protectedPreview = process.env.KARTISERET_MEASURE_VERCEL === "1";
const previewMissWindow = process.env.KARTISERET_MEASURE_PREVIEW_MISS_WINDOW;
if (
  previewMissWindow &&
  ((!protectedPreview && !previewCookieFile) ||
    !base.hostname.endsWith(".vercel.app"))
) {
  throw new Error(
    "Cache-miss query variants are only available for protected previews.",
  );
}
const directory = await mkdtemp(
  join(tmpdir(), "kartiseret-public-measurement-"),
);
const bodyPath = join(directory, "body");
const headersPath = join(directory, "headers");
const retainedHeaders = new Set([
  "age",
  "cache-control",
  "cf-cache-status",
  "content-encoding",
  "content-type",
  "server-timing",
  "x-robots-tag",
  "x-vercel-cache",
  "x-vercel-id",
]);

try {
  for (let iteration = 1; iteration <= count; iteration += 1) {
    for (const route of routes) {
      const url = new URL(route, base);
      if (url.origin !== base.origin)
        throw new Error("Routes must stay on the requested origin.");
      if (previewMissWindow)
        url.searchParams.set("perf_probe", `${previewMissWindow}-${iteration}`);
      const record = {
        timestamp: new Date().toISOString(),
        label,
        iteration,
        origin: base.origin,
        route,
        queryVariant: previewMissWindow ?? null,
      };
      try {
        const curlArgs = [
          "--silent",
          "--show-error",
          "--compressed",
          "--max-time",
          "20",
          "--dump-header",
          headersPath,
          "--output",
          bodyPath,
          "--write-out",
          "%{json}",
        ];
        const { stdout } =
          protectedPreview && !previewCookieFile
            ? await runCurl("npx", [
                "--yes",
                "vercel",
                "curl",
                url.toString(),
                "--",
                ...curlArgs,
              ])
            : await runCurl("curl", [
                ...curlArgs,
                ...(previewCookieFile ? ["--cookie", previewCookieFile] : []),
                url.toString(),
              ]);
        const timing = JSON.parse(stdout);
        const rawHeaders = await readFile(headersPath, "utf8");
        const headers = Object.fromEntries(
          rawHeaders.split(/\r?\n/).flatMap((line) => {
            const index = line.indexOf(":");
            const key = line.slice(0, index).toLowerCase();
            return index > 0 && retainedHeaders.has(key)
              ? [[key, line.slice(index + 1).trim()]]
              : [];
          }),
        );
        const body = await readFile(bodyPath);
        const html = body.toString();
        const title = html.match(/<title>([^<]*)<\/title>/i)?.[1];
        const canonical = html.match(
          /<link rel="canonical" href="([^"]*)"/i,
        )?.[1];
        const bootstrapJson = html.match(
          /<script\b[^>]*\bid="kartiseret-bootstrap"[^>]*>(.*?)<\/script>/s,
        )?.[1];
        const bootstrap = bootstrapJson ? JSON.parse(bootstrapJson) : null;
        const expectedDocument =
          timing.http_code === 200 &&
          !!title &&
          headers["content-type"]?.includes("text/html");
        const accepted = expectedDocument
          ? title !== "Deployment is building" && !!canonical && !!bootstrap
          : timing.http_code === 404 ||
            (timing.http_code === 200 &&
              (route === "/robots.txt" || route === "/sitemap.xml"));
        const cache = headers["x-vercel-cache"];
        console.log(
          JSON.stringify({
            ...record,
            status: timing.http_code,
            accepted,
            publicationRevision: bootstrap?.publicationRevision,
            catalogCounts: bootstrap
              ? {
                  nowPlaying: bootstrap.catalogs?.nowPlaying?.movies.length,
                  comingSoon: bootstrap.catalogs?.comingSoon?.movies.length,
                }
              : undefined,
            cache: cache ?? null,
            invocationTemperature: "unknown",
            dnsMs: timing.time_namelookup * 1000,
            connectMs: timing.time_connect * 1000,
            tlsMs: timing.time_appconnect * 1000,
            ttfbMs: timing.time_starttransfer * 1000,
            totalMs: timing.time_total * 1000,
            transferBytes: timing.size_download,
            decodedBytes: body.length,
            title,
            canonical,
            headers,
          }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            ...record,
            error: error.code ?? "measurement_failed",
          }),
        );
      }
      await setTimeout(250);
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
