import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { collectEagerJavaScriptUrls, measureEagerJavaScript } from "./check-client-bundle.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("eager client bundle measurement", () => {
  it("finds the module entry and deduplicated modulepreloads", () => {
    const html = `
      <script crossorigin src="/assets/index.js" type="module"></script>
      <link href="/assets/shared.js" rel="modulepreload" crossorigin>
      <link rel="modulepreload" href="/assets/shared.js">
      <script src="/legacy.js"></script>
    `;

    expect(collectEagerJavaScriptUrls(html)).toEqual([
      "/assets/index.js",
      "/assets/shared.js",
    ]);
  });

  it("measures only JavaScript referenced by the generated HTML", () => {
    const distRoot = mkdtempSync(join(tmpdir(), "kartiseret-bundle-test-"));
    temporaryDirectories.push(distRoot);
    mkdirSync(join(distRoot, "assets"));

    const entry = "console.log('entry');";
    const shared = "export const value = 42;";
    writeFileSync(
      join(distRoot, "index.html"),
      '<script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/shared.js">',
    );
    writeFileSync(join(distRoot, "assets/index.js"), entry);
    writeFileSync(join(distRoot, "assets/shared.js"), shared);
    writeFileSync(join(distRoot, "assets/lazy.js"), "not eager");

    expect(measureEagerJavaScript(distRoot)).toMatchObject({
      rawBytes: Buffer.byteLength(entry) + Buffer.byteLength(shared),
      gzipBytes: gzipSync(entry).byteLength + gzipSync(shared).byteLength,
      assets: [{ path: "assets/index.js" }, { path: "assets/shared.js" }],
    });
  });
});
