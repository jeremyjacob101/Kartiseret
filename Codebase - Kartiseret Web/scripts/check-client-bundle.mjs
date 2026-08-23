import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { z } from "zod";

const DEFAULT_EAGER_JS_GZIP_BUDGET_BYTES = 200 * 1024;
const LOCAL_BUNDLE_ORIGIN = "https://bundle.local";
const scriptPath = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(scriptPath), "..");

const budgetSchema = z.coerce
  .number()
  .int()
  .positive()
  .default(DEFAULT_EAGER_JS_GZIP_BUDGET_BYTES);

function readAttribute(tag, attribute) {
  const match = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

export function collectEagerJavaScriptUrls(html) {
  const urls = [];

  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const type = readAttribute(tag, "type");
    const source = readAttribute(tag, "src");

    if (type === "module" && source) {
      urls.push(source);
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const relationships = readAttribute(tag, "rel")?.split(/\s+/) ?? [];
    const href = readAttribute(tag, "href");

    if (relationships.includes("modulepreload") && href) {
      urls.push(href);
    }
  }

  return [...new Set(urls)];
}

function resolveLocalAssetPath(distRoot, assetUrl) {
  const parsedUrl = new URL(assetUrl, LOCAL_BUNDLE_ORIGIN);

  if (parsedUrl.origin !== LOCAL_BUNDLE_ORIGIN) {
    throw new Error(`Cannot measure external eager script: ${assetUrl}`);
  }

  const assetPath = resolve(
    distRoot,
    `.${decodeURIComponent(parsedUrl.pathname)}`,
  );
  const relativePath = relative(distRoot, assetPath);

  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Invalid eager script path: ${assetUrl}`);
  }

  return { assetPath, relativePath };
}

export function measureEagerJavaScript(distRoot) {
  const html = readFileSync(resolve(distRoot, "index.html"), "utf8");
  const assetUrls = collectEagerJavaScriptUrls(html);

  if (assetUrls.length === 0) {
    throw new Error("No eager JavaScript entry or modulepreload assets found.");
  }

  const assets = assetUrls.map((assetUrl) => {
    const { assetPath, relativePath } = resolveLocalAssetPath(
      distRoot,
      assetUrl,
    );
    const contents = readFileSync(assetPath);

    return {
      path: relativePath,
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents).byteLength,
    };
  });

  return {
    assets,
    rawBytes: assets.reduce((total, asset) => total + asset.rawBytes, 0),
    gzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0),
  };
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function checkClientBundle({
  budgetBytes = budgetSchema.parse(process.env.EAGER_JS_GZIP_BUDGET_BYTES),
  distRoot = resolve(appRoot, "dist"),
} = {}) {
  const measurement = measureEagerJavaScript(distRoot);

  console.log("Eager client JavaScript:");
  for (const asset of measurement.assets) {
    console.log(
      `  ${asset.path}: ${formatKib(asset.rawBytes)} raw, ${formatKib(asset.gzipBytes)} gzip`,
    );
  }
  console.log(
    `  total: ${formatKib(measurement.rawBytes)} raw, ${formatKib(measurement.gzipBytes)} gzip`,
  );
  console.log(`  budget: ${formatKib(budgetBytes)} gzip`);

  if (measurement.gzipBytes > budgetBytes) {
    throw new Error(
      `Eager client JavaScript exceeds the gzip budget by ${formatKib(measurement.gzipBytes - budgetBytes)}.`,
    );
  }

  return measurement;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    checkClientBundle();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
