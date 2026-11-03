import { cases, encodedPath, makeBootstrap, renderPublicApplication } from "./ssrBuiltOutput.mjs";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { join } from "node:path";

const distRoot = resolve("dist");
const baseHtml = await readFile(resolve(distRoot, "index.html"), "utf8");
const screenshotDir = process.env.SSR_BROWSER_SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const cinemaIdentity = CINEMA_IDENTITIES.find(
  (identity) => identity.displayName === "Cinema City Jerusalem",
);
assert.ok(cinemaIdentity);

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pageTitle(pathname) {
  if (pathname.startsWith("/c/")) {
    return `${cinemaIdentity.displayName} showtimes | Kartiseret`;
  }
  if (pathname === "/movies") return "Movies showing in Israel | Kartiseret";
  if (pathname === "/soons") return "Coming soon movies in Israel | Kartiseret";
  if (pathname === "/showtimes")
    return "Movie showtimes in Jerusalem | Kartiseret";
  if (pathname === "/cinematheques")
    return "Cinematheque movie showtimes | Kartiseret";
  if (pathname.startsWith("/Ab1"))
    return "SSR Test Movie showtimes | Kartiseret";
  return "Kartiseret — Movie showtimes across Israel";
}

async function htmlFor(
  pathname,
  bootstrap = makeBootstrap(pathname),
  clientBootstrap = bootstrap,
) {
  const markup = await renderPublicApplication(bootstrap);
  const canonicalPath = pathname.startsWith("/Ab1") ? "/Ab1" : pathname;
  const canonical = `https://seret.site${canonicalPath === "/" ? "/" : canonicalPath}`;
  const title = pageTitle(pathname);
  const metadata = `<!-- SEO_META_START --><title>${title}</title><meta name="description" content="${title}" /><link rel="canonical" href="${escapeAttribute(canonical)}" /><meta name="robots" content="index, follow" /><!-- SEO_META_END -->`;
  const bootstrapJson = JSON.stringify(clientBootstrap)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  const html = baseHtml
    .replace(/<!-- SEO_META_START -->[\s\S]*?<!-- SEO_META_END -->/, metadata)
    .replace(
      '<div id="root"></div>',
      `<div id="root" data-ssr="true">${markup}</div>`,
    )
    .replace(
      "</body>",
      `<script id="kartiseret-bootstrap" type="application/json">${bootstrapJson}</script><script>window.__KARTISERET_BOOTSTRAP__=JSON.parse(document.getElementById("kartiseret-bootstrap").textContent||"null")</script></body>`,
    );
  return html;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          data: null,
          error: { code: "not_found", message: "Not found." },
        }),
      );
      return;
    }

    if (
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/logos/")
    ) {
      const filePath = resolve(
        distRoot,
        `.${decodeURIComponent(url.pathname)}`,
      );
      const pathFromDist = relative(distRoot, filePath);
      if (pathFromDist.startsWith("..")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = await readFile(filePath);
      const type = filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
        : filePath.endsWith(".svg")
          ? "image/svg+xml"
          : filePath.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
      response.writeHead(200, { "Content-Type": type });
      response.end(body);
      return;
    }

    const pathname = decodeURIComponent(url.pathname);
    const bootstrap = makeBootstrap(pathname);
    let clientBootstrap = bootstrap;
    if (url.searchParams.get("stale") === "1") {
      clientBootstrap = {
        ...bootstrap,
        renderedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      };
    }
    const html = await htmlFor(pathname, bootstrap, clientBootstrap);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      error instanceof Error ? error.message : "SSR smoke server failed.",
    );
  }
});

await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
assert.ok(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const noScriptPage = await browser.newPage({ javaScriptEnabled: false });
  const noScriptResponse = await noScriptPage.goto(`${baseUrl}/movies`);
  assert.equal(noScriptResponse?.status(), 200);
  assert.equal(await noScriptPage.locator("#root[data-ssr='true']").count(), 1);
  assert.equal(
    await noScriptPage.getByRole("heading", { name: "Now Playing" }).count(),
    1,
  );
  assert.equal(await noScriptPage.locator('a[href="/Ab1"]').count(), 1);
  if (screenshotDir) {
    await noScriptPage.screenshot({
      path: join(screenshotDir, "movies-desktop-without-javascript.png"),
      fullPage: true,
    });
  }
  await noScriptPage.close();

  const mobilePage = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  await mobilePage.goto(`${baseUrl}/movies`);
  assert.equal(
    await mobilePage.getByRole("heading", { name: "Now Playing" }).count(),
    1,
  );
  assert.equal(await mobilePage.locator('a[href="/Ab1"]').count(), 1);
  if (screenshotDir) {
    await mobilePage.screenshot({
      path: join(screenshotDir, "movies-mobile-without-javascript.png"),
      fullPage: true,
    });
  }
  await mobilePage.close();

  const mobileHydrationPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const mobileHydrationErrors = [];
  let releaseMobileEntryScript;
  let releaseMobileRouteChunk;
  let notifyMobileEntryScriptRequested;
  let notifyMobileRouteChunkRequested;
  const mobileEntryScriptRequested = new Promise((resolveRequested) => {
    notifyMobileEntryScriptRequested = resolveRequested;
  });
  const mobileRouteChunkRequested = new Promise((resolveRequested) => {
    notifyMobileRouteChunkRequested = resolveRequested;
  });
  mobileHydrationPage.on("pageerror", (error) =>
    mobileHydrationErrors.push(error.message));
  mobileHydrationPage.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text())) {
      mobileHydrationErrors.push(message.text());
    }
  });
  await mobileHydrationPage.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      await route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
      });
      return;
    }
    if (/\/assets\/index-[^/]+\.js$/.test(url.pathname)) {
      notifyMobileEntryScriptRequested();
      await new Promise((resolveRelease) => {
        releaseMobileEntryScript = resolveRelease;
      });
    }
    if (/\/assets\/PosterGridPage-[^/]+\.js$/.test(url.pathname)) {
      notifyMobileRouteChunkRequested();
      await new Promise((resolveRelease) => {
        releaseMobileRouteChunk = resolveRelease;
      });
    }
    await route.continue();
  });
  await mobileHydrationPage.goto(`${baseUrl}/movies`, {
    waitUntil: "commit",
  });
  await mobileEntryScriptRequested;
  assert.equal(
    await mobileHydrationPage.locator("#root[data-ssr='true']").count(),
    1,
  );
  const mobileHeading = mobileHydrationPage.getByRole("heading", {
    name: "Now Playing",
  });
  await mobileHeading.waitFor({ state: "visible" });
  assert.equal(await mobileHeading.count(), 1);
  const headingBeforeHydration = await mobileHeading.boundingBox();
  assert.ok(headingBeforeHydration);
  const mobilePoster = mobileHydrationPage
    .locator(".poster-grid-page-tile")
    .first();
  await mobilePoster.waitFor({ state: "visible" });
  const posterBeforeHydration = await mobilePoster.boundingBox();
  assert.ok(posterBeforeHydration);
  if (screenshotDir) {
    await mobileHydrationPage.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await mobileHydrationPage.screenshot({
      path: join(screenshotDir, "movies-mobile-before-hydration.png"),
      fullPage: true,
    });
  }
  releaseMobileEntryScript?.();
  await mobileRouteChunkRequested;
  assert.equal(await mobileHeading.count(), 1);
  const headingDuringPreload = await mobileHeading.boundingBox();
  assert.ok(headingDuringPreload);
  assert.ok(
    Math.abs(headingDuringPreload.y - headingBeforeHydration.y) < 1,
    "server-rendered heading should stay in place while the route chunk loads",
  );
  if (screenshotDir) {
    await mobileHydrationPage.screenshot({
      path: join(screenshotDir, "movies-mobile-during-route-preload.png"),
      fullPage: true,
    });
  }
  releaseMobileRouteChunk?.();
  await mobileHydrationPage.waitForLoadState("load");
  await mobileHydrationPage.waitForTimeout(150);
  assert.equal(await mobileHeading.count(), 1);
  const headingAfterHydration = await mobileHeading.boundingBox();
  assert.ok(headingAfterHydration);
  const posterAfterHydration = await mobilePoster.boundingBox();
  assert.ok(posterAfterHydration);
  assert.ok(
    Math.abs(posterAfterHydration.width - posterBeforeHydration.width) < 1 &&
      Math.abs(posterAfterHydration.height - posterBeforeHydration.height) <
        1 &&
      Math.abs(headingAfterHydration.y - headingBeforeHydration.y) < 1,
    "mobile poster and heading layout should remain stable through hydration",
  );
  assert.deepEqual(mobileHydrationErrors, []);
  if (screenshotDir) {
    await mobileHydrationPage.screenshot({
      path: join(screenshotDir, "movies-mobile-after-hydration.png"),
      fullPage: true,
    });
  }
  console.log("Mobile poster dimensions before/after hydration:", {
    before: {
      width: posterBeforeHydration.width,
      height: posterBeforeHydration.height,
    },
    after: {
      width: posterAfterHydration.width,
      height: posterAfterHydration.height,
    },
  });
  await mobileHydrationPage.close();

  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const hydrationErrors = [];
  let pauseDesktopEntryScript = true;
  let pauseDesktopRouteChunk = true;
  let releaseDesktopEntryScript;
  let releaseDesktopRouteChunk;
  let notifyDesktopEntryScriptRequested;
  let notifyDesktopRouteChunkRequested;
  const desktopEntryScriptRequested = new Promise((resolveRequested) => {
    notifyDesktopEntryScriptRequested = resolveRequested;
  });
  const desktopRouteChunkRequested = new Promise((resolveRequested) => {
    notifyDesktopRouteChunkRequested = resolveRequested;
  });
  page.on("pageerror", (error) => hydrationErrors.push(error.message));
  page.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      await route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
      });
      return;
    }
    if (
      pauseDesktopEntryScript &&
      /\/assets\/index-[^/]+\.js$/.test(url.pathname)
    ) {
      pauseDesktopEntryScript = false;
      notifyDesktopEntryScriptRequested();
      await new Promise((resolveRelease) => {
        releaseDesktopEntryScript = resolveRelease;
      });
    }
    if (
      pauseDesktopRouteChunk &&
      /\/assets\/PosterGridPage-[^/]+\.js$/.test(url.pathname)
    ) {
      pauseDesktopRouteChunk = false;
      notifyDesktopRouteChunkRequested();
      await new Promise((resolveRelease) => {
        releaseDesktopRouteChunk = resolveRelease;
      });
    }
    await route.continue();
  });

  await page.goto(`${baseUrl}/movies`, { waitUntil: "commit" });
  await desktopEntryScriptRequested;
  const root = page.locator("#root[data-ssr='true']");
  assert.equal(await root.count(), 1);
  const desktopHeading = page.getByRole("heading", { name: "Now Playing" });
  await desktopHeading.waitFor({ state: "visible" });
  assert.equal(await desktopHeading.count(), 1);
  const desktopHeadingBeforeHydration = await desktopHeading.boundingBox();
  assert.ok(desktopHeadingBeforeHydration);
  const desktopPoster = page.locator(".poster-grid-page-tile").first();
  await desktopPoster.waitFor({ state: "visible" });
  const desktopPosterBeforeHydration = await desktopPoster.boundingBox();
  assert.ok(desktopPosterBeforeHydration);
  assert.equal(await page.locator('a[href="/Ab1"]').count(), 1);
  if (screenshotDir) {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({
      path: join(screenshotDir, "movies-desktop-before-hydration.png"),
      fullPage: true,
    });
  }
  releaseDesktopEntryScript?.();
  await desktopRouteChunkRequested;
  assert.equal(await desktopHeading.count(), 1);
  const desktopHeadingDuringPreload = await desktopHeading.boundingBox();
  assert.ok(desktopHeadingDuringPreload);
  assert.ok(
    Math.abs(desktopHeadingDuringPreload.y - desktopHeadingBeforeHydration.y) <
      1,
    "server-rendered heading should stay in place while the desktop route chunk loads",
  );
  if (screenshotDir) {
    await page.screenshot({
      path: join(screenshotDir, "movies-desktop-during-route-preload.png"),
      fullPage: true,
    });
  }
  releaseDesktopRouteChunk?.();
  await page.waitForLoadState("load");
  await page.waitForTimeout(150);
  assert.equal(await desktopHeading.count(), 1);
  const desktopHeadingAfterHydration = await desktopHeading.boundingBox();
  const desktopPosterAfterHydration = await desktopPoster.boundingBox();
  assert.ok(desktopHeadingAfterHydration);
  assert.ok(desktopPosterAfterHydration);
  assert.ok(
    Math.abs(desktopHeadingAfterHydration.y - desktopHeadingBeforeHydration.y) <
      1 &&
      Math.abs(
        desktopPosterAfterHydration.width - desktopPosterBeforeHydration.width,
      ) < 1 &&
      Math.abs(
        desktopPosterAfterHydration.height -
          desktopPosterBeforeHydration.height,
      ) < 1,
    "desktop heading and poster layout should remain stable through hydration",
  );
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    "https://seret.site/movies",
  );
  assert.deepEqual(hydrationErrors, []);
  if (screenshotDir) {
    await page.screenshot({
      path: join(screenshotDir, "movies-desktop-after-hydration.png"),
      fullPage: true,
    });
  }

  const delayedApiPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const delayedApiRequests = [];
  const delayedApiHydrationErrors = [];
  delayedApiPage.on("pageerror", (error) =>
    delayedApiHydrationErrors.push(error.message));
  delayedApiPage.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text())) {
      delayedApiHydrationErrors.push(message.text());
    }
  });
  await delayedApiPage.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      await route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
      });
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    delayedApiRequests.push(url.pathname);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        data: null,
        error: { code: "temporarily_unavailable", message: "Try again." },
      }),
    });
  });
  await delayedApiPage.goto(`${baseUrl}/movies?stale=1`, {
    waitUntil: "domcontentloaded",
  });
  await delayedApiPage.waitForLoadState("load");
  await delayedApiPage
    .getByRole("heading", { name: "Now Playing" })
    .waitFor({ state: "visible", timeout: 5_000 });
  assert.equal(
    await delayedApiPage.getByRole("heading", { name: "Now Playing" }).count(),
    1,
  );
  assert.equal(await delayedApiPage.locator('a[href="/Ab1"]').count(), 1);
  assert.ok(
    delayedApiRequests.includes("/api/v1/catalog/now-playing"),
    "stale catalog data refetches",
  );
  assert.ok(
    delayedApiRequests.includes("/api/auth/get-session"),
    "client preferences initialize after hydration",
  );
  await delayedApiPage.waitForTimeout(850);
  assert.equal(
    await delayedApiPage.getByRole("heading", { name: "Now Playing" }).count(),
    1,
  );
  assert.equal(await delayedApiPage.locator('a[href="/Ab1"]').count(), 1);
  assert.deepEqual(delayedApiHydrationErrors, []);
  await delayedApiPage.close();

  const failedScriptPage = await browser.newPage();
  await failedScriptPage.route("**/assets/index-*.js", (route) =>
    route.abort());
  await failedScriptPage.goto(`${baseUrl}/movies`);
  await failedScriptPage.waitForTimeout(300);
  assert.equal(
    await failedScriptPage
      .getByRole("heading", { name: "Now Playing" })
      .count(),
    1,
  );
  assert.equal(await failedScriptPage.locator('a[href="/Ab1"]').count(), 1);
  await failedScriptPage.close();

  await page.goto(`${baseUrl}${encodedPath}`, { waitUntil: "load" });
  assert.equal(new URL(page.url()).pathname, encodedPath);
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    "https://seret.site/Ab1",
  );
  await page.close();

  const cinemaPage = await browser.newPage({ javaScriptEnabled: false });
  await cinemaPage.goto(`${baseUrl}/c/${cinemaIdentity.id}`);
  assert.equal(
    await cinemaPage
      .getByRole("heading", { name: cinemaIdentity.displayName })
      .count(),
    1,
  );
  assert.equal(await cinemaPage.locator('a[href="/Ab1"]').count(), 1);
  await cinemaPage.close();
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())));
}

console.log(
  "Built browser SSR smoke passed with JavaScript disabled and after hydration.",
);
