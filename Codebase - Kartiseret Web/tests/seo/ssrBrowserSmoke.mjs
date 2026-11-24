import { cases, encodedPath, makeBootstrap, renderPublicApplication } from "./ssrBuiltOutput.mjs";
import { DEFAULT_SHOWTIME_PREFERENCES } from "@kartiseret/contracts/showtime-preferences";
import { getShowtimesCityFromPath } from "@kartiseret/contracts/showtime-routes";
import { PUBLICATION_REVISION_HEADER } from "@kartiseret/contracts/public-data";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { addCalendarDays } from "@kartiseret/contracts/showtime-links";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
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
const posterFixture = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#00ff00"/></svg>',
);

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pageTitle(pathname) {
  const city = getShowtimesCityFromPath(pathname);
  if (city) return `Movie showtimes in ${city} — Now Playing | Kartiseret`;
  if (pathname.startsWith("/c/")) {
    return `${cinemaIdentity.displayName} showtimes | Kartiseret`;
  }
  if (pathname === "/movies") return "Movies showing in Israel | Kartiseret";
  if (pathname === "/soons") return "Coming soon movies in Israel | Kartiseret";
  if (pathname === "/showtimes")
    return "Movie showtimes in Israel — Now Playing | Kartiseret";
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
  display,
) {
  const markup = await renderPublicApplication(bootstrap, 12_000, display);
  const canonicalPath = pathname.startsWith("/Ab1") ? "/Ab1" : pathname;
  const canonical = `https://seret.site${canonicalPath === "/" ? "/" : canonicalPath}`;
  const title = pageTitle(pathname);
  const metadata = `<!-- SEO_META_START --><title>${title}</title><meta name="description" content="${title}" /><link rel="canonical" href="${escapeAttribute(canonical)}" /><meta name="robots" content="index, follow" /><!-- SEO_META_END -->`;
  const initialPosters =
    pathname === "/"
      ? [
          bootstrap.catalogs.nowPlaying.movies.at(-1),
          ...bootstrap.catalogs.nowPlaying.movies.slice(0, 4),
        ]
      : [];
  const preloadTags = [
    ...new Set(initialPosters.map((movie) => movie?.imageSrc)),
  ]
    .filter(Boolean)
    .map(
      (imageSrc) =>
        `<link rel="preload" as="image" href="${escapeAttribute(imageSrc)}" fetchpriority="high" />`,
    )
    .join("");
  const bootstrapJson = JSON.stringify(clientBootstrap)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
  const displayScript = display
    ? `<script id="kartiseret-display" type="application/json">${JSON.stringify(display)}</script>`
    : "";
  const template = display
    ? baseHtml.replace(
        "<html ",
        `<html data-initial-site-color="${display.preferences.siteColor}" style="--main-app-color:${display.preferences.siteColor}" `,
      )
    : baseHtml;
  const html = template
    .replace(/<!-- SEO_META_START -->[\s\S]*?<!-- SEO_META_END -->/, metadata)
    .replace("</head>", () => `${preloadTags}</head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root" data-ssr="true">${markup}</div>`,
    )
    .replace(
      "</body>",
      `<script id="kartiseret-bootstrap" type="application/json">${bootstrapJson}</script><script>window.__KARTISERET_BOOTSTRAP__=JSON.parse(document.getElementById("kartiseret-bootstrap").textContent||"null")</script>${displayScript}</body>`,
    );
  return html;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/_vercel/insights/script.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end();
      return;
    }
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
    if (pathname === "/" && url.searchParams.get("five-posters") === "1") {
      const original = bootstrap.catalogs.nowPlaying.movies[0];
      bootstrap.catalogs.nowPlaying.movies = Array.from({ length: 5 }, (
        _,
        index,
      ) => ({
        ...original,
        tmdbId: String(201 + index),
        movieCode: `Ax${index}`,
        title: `Opening poster ${index}`,
        imageSrc: `https://images.example.test/opening-${index}.svg`,
        imageSrcSet: undefined,
      }));
    }
    let clientBootstrap = bootstrap;
    if (url.searchParams.get("stale") === "1") {
      clientBootstrap = {
        ...bootstrap,
        renderedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      };
    }
    const display =
      pathname === "/" && url.searchParams.get("private-home") === "1"
        ? {
            version: 1,
            accountKey: "0".repeat(64),
            preferences: {
              location: "Tel Aviv",
              siteColor: "#69b0e2",
              hideReReleases: true,
              notificationDelivery: "email",
              ratingSources: [],
              showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
            },
            movieTreatments: [
              {
                tmdbId: "101",
                title: "SSR Test Movie",
                releaseYear: null,
                treatment: "remove",
                hideBackdrop: false,
              },
            ],
          }
        : undefined;
    const html = await htmlFor(pathname, bootstrap, clientBootstrap, display);
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
  const privateHome = await browser.newPage({ reducedMotion: "reduce" });
  const privateHomeErrors = [];
  privateHome.on("pageerror", (error) => privateHomeErrors.push(error.message));
  privateHome.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text()))
      privateHomeErrors.push(message.text());
  });
  await privateHome.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline session fixture" } }));
  const privateHomeResponse = await privateHome.goto(
    baseUrl + "/?private-home=1",
  );
  assert.match(
    await privateHomeResponse.text(),
    /data-initial-site-color="#69b0e2"/,
  );
  assert.doesNotMatch(await privateHomeResponse.text(), /href="\/Ab1"/);
  await privateHome
    .locator('.movie-scroller-card[href="/Cd2"]')
    .first()
    .waitFor();
  assert.equal(await privateHome.locator('main a[href="/Ab1"]').count(), 0);
  assert.equal(
    await privateHome.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--main-app-color")
        .trim()),
    "rgb(105, 176, 226)",
  );
  assert.deepEqual(privateHomeErrors, []);
  await privateHome.close();

  const introPage = await browser.newPage({ reducedMotion: "no-preference" });
  let releaseLastPoster;
  const lastPoster = new Promise((resolve) => {
    releaseLastPoster = resolve;
  });
  await introPage.route("https://images.example.test/**", async (route) => {
    if (route.request().url().endsWith("opening-4.svg")) await lastPoster;
    await route.fulfill({ contentType: "image/svg+xml", body: posterFixture });
  });
  try {
    await introPage.goto(baseUrl + "/?five-posters=1", {
      waitUntil: "domcontentloaded",
    });
    const firstScroller = introPage.locator(".scroller-slot").first();
    await firstScroller.locator('[data-scroller-intro-phase="pre"]').waitFor();
    await introPage.waitForFunction(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => /opening-[0-3]\.svg$/.test(entry.name)).length >=
        4,
    );
    assert.equal(
      await firstScroller.locator('[data-scroller-intro-phase="pre"]').count(),
      1,
    );
    releaseLastPoster();
    await firstScroller
      .locator('[data-scroller-intro-phase="animating"]')
      .waitFor();
    await firstScroller.locator('[data-scroller-intro-phase="done"]').waitFor();
  } finally {
    releaseLastPoster();
    await introPage.close();
  }

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

  const noScriptHomePage = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  await noScriptHomePage.goto(`${baseUrl}/`);
  assert.equal(
    await noScriptHomePage
      .getByRole("heading", { name: "New Releases" })
      .count(),
    1,
  );
  assert.equal(
    await noScriptHomePage
      .getByRole("heading", { name: "Coming Soon" })
      .count(),
    1,
  );
  assert.equal(
    await noScriptHomePage
      .getByRole("heading", { name: "Re-Releases" })
      .count(),
    1,
  );
  assert.equal(
    await noScriptHomePage.locator(".movie-scroller-card").count(),
    0,
    "the browser-only poster scroller remains unmounted when JavaScript is disabled",
  );
  if (screenshotDir) {
    await noScriptHomePage.screenshot({
      path: join(screenshotDir, "home-desktop-without-javascript.png"),
      fullPage: true,
    });
  }
  await noScriptHomePage.close();

  const delayedHomePage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const delayedHomeErrors = [];
  let releaseHomeEntryScript;
  let notifyHomeEntryScriptRequested;
  const homeEntryScriptRequested = new Promise((resolveRequested) => {
    notifyHomeEntryScriptRequested = resolveRequested;
  });
  const homeRequestOrder = [];
  const homeNavigationStartedAt = Date.now();
  let homePosterRequestAt = null;
  delayedHomePage.on("pageerror", (error) =>
    delayedHomeErrors.push(error.message));
  delayedHomePage.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text())) {
      delayedHomeErrors.push(message.text());
    }
  });
  delayedHomePage.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "images.example.test") {
      homeRequestOrder.push("poster");
      homePosterRequestAt ??= Date.now();
    }
    if (url.pathname === "/api/auth/get-session") {
      homeRequestOrder.push("auth");
    }
  });
  await delayedHomePage.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "images.example.test") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: posterFixture,
      });
      return;
    }
    if (
      url.hostname === "127.0.0.1" &&
      /\/assets\/index-[^/]+\.js$/.test(url.pathname)
    ) {
      notifyHomeEntryScriptRequested();
      await new Promise((resolveRelease) => {
        releaseHomeEntryScript = resolveRelease;
      });
    }
    await route.continue();
  });
  await delayedHomePage.goto(baseUrl + "/", { waitUntil: "commit" });
  await homeEntryScriptRequested;
  assert.equal(
    await delayedHomePage.locator("#root[data-ssr='true']").count(),
    1,
  );
  assert.equal(
    await delayedHomePage
      .getByRole("heading", { name: "New Releases" })
      .count(),
    1,
  );
  assert.equal(
    await delayedHomePage.locator(".movie-scroller-card").count(),
    0,
    "the existing poster scroller is not rendered or reshaped by SSR",
  );
  assert.ok(
    homeRequestOrder.includes("poster"),
    "the initial viewport posters are requested from HTML before the app script runs",
  );
  assert.ok(!homeRequestOrder.includes("auth"));
  assert.equal(
    await delayedHomePage
      .locator(".home-poster-row")
      .first()
      .evaluate((row) => getComputedStyle(row).visibility),
    "hidden",
    "the settled fallback does not flash before the scroller flies in",
  );
  const desktopBeforeHydration = await delayedHomePage.evaluate(() => {
    const slot = document.querySelector(".scroller-slot");
    const nextHeading = [...document.querySelectorAll(".section-heading")][1];
    return {
      slotHeight: slot?.getBoundingClientRect().height,
      nextHeadingY: nextHeading?.getBoundingClientRect().y,
    };
  });
  if (screenshotDir) {
    await delayedHomePage.screenshot({
      path: join(screenshotDir, "home-desktop-before-hydration.png"),
      fullPage: true,
    });
  }
  releaseHomeEntryScript?.();
  await delayedHomePage
    .locator(".scroller-slot")
    .first()
    .locator('[data-scroller-intro-phase="animating"]')
    .waitFor();
  await delayedHomePage.waitForFunction(() =>
    [...document.querySelectorAll(".movie-scroller-card img")].some((image) => {
      const bounds = image.getBoundingClientRect();
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        bounds.right > 0 &&
        bounds.bottom > 0 &&
        bounds.left < innerWidth &&
        bounds.top < innerHeight
      );
    }));
  await delayedHomePage.waitForTimeout(1400);
  assert.deepEqual(delayedHomeErrors, []);
  assert.ok(homeRequestOrder.includes("poster"));
  assert.ok(homePosterRequestAt !== null);
  const desktopAfterHydration = await delayedHomePage.evaluate(() => {
    const slot = document.querySelector(".scroller-slot");
    const nextHeading = [...document.querySelectorAll(".section-heading")][1];
    return {
      slotHeight: slot?.getBoundingClientRect().height,
      nextHeadingY: nextHeading?.getBoundingClientRect().y,
      visibleLoadedPosters: [
        ...document.querySelectorAll(".movie-scroller-card img"),
      ].filter((image) => {
        const bounds = image.getBoundingClientRect();
        return (
          image.complete &&
          image.naturalWidth > 0 &&
          bounds.right > 0 &&
          bounds.bottom > 0 &&
          bounds.left < innerWidth &&
          bounds.top < innerHeight
        );
      }).length,
    };
  });
  assert.ok(desktopAfterHydration.visibleLoadedPosters > 0);
  assert.ok(
    Math.abs(
      desktopAfterHydration.nextHeadingY - desktopBeforeHydration.nextHeadingY,
    ) < 1,
    "mounting the existing scroller does not move the next section",
  );
  if (screenshotDir) {
    await delayedHomePage.screenshot({
      path: join(screenshotDir, "home-desktop-after-hydration.png"),
      fullPage: true,
    });
  }
  const firstPosterRequestElapsed =
    homePosterRequestAt - homeNavigationStartedAt;
  await delayedHomePage.close();
  console.log(
    "Existing scroller mounted after hydration: first poster request " +
      firstPosterRequestElapsed +
      "ms, " +
      desktopAfterHydration.visibleLoadedPosters +
      " decoded posters visible, no hydration errors.",
  );

  const mobileHomePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const mobileHomeErrors = [];
  let releaseMobileHomeEntryScript;
  let notifyMobileHomeEntryScriptRequested;
  const mobileHomeEntryScriptRequested = new Promise((resolveRequested) => {
    notifyMobileHomeEntryScriptRequested = resolveRequested;
  });
  mobileHomePage.on("pageerror", (error) =>
    mobileHomeErrors.push(error.message));
  mobileHomePage.on("console", (message) => {
    if (/hydration|did not match|server rendered/i.test(message.text())) {
      mobileHomeErrors.push(message.text());
    }
  });
  await mobileHomePage.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "images.example.test") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: posterFixture,
      });
      return;
    }
    if (
      url.hostname === "127.0.0.1" &&
      /\/assets\/index-[^/]+\.js$/.test(url.pathname)
    ) {
      notifyMobileHomeEntryScriptRequested();
      await new Promise((resolveRelease) => {
        releaseMobileHomeEntryScript = resolveRelease;
      });
    }
    await route.continue();
  });
  await mobileHomePage.goto(baseUrl + "/", { waitUntil: "commit" });
  await mobileHomeEntryScriptRequested;
  await mobileHomePage.waitForFunction(() => {
    const slot = document.querySelector(".scroller-slot");
    return (
      document.documentElement.dataset.deviceType === "mobile" &&
      slot &&
      getComputedStyle(slot).minHeight === "300px"
    );
  });
  const mobileBeforeHydration = await mobileHomePage.evaluate(() => {
    const slot = document.querySelector(".scroller-slot");
    const nextHeading = [...document.querySelectorAll(".section-heading")][1];
    return {
      slotHeight: slot?.getBoundingClientRect().height,
      nextHeadingY: nextHeading?.getBoundingClientRect().y,
    };
  });
  assert.equal(await mobileHomePage.locator(".movie-scroller-card").count(), 0);
  if (screenshotDir) {
    await mobileHomePage.screenshot({
      path: join(screenshotDir, "home-mobile-before-hydration.png"),
      fullPage: true,
    });
  }
  releaseMobileHomeEntryScript?.();
  await mobileHomePage.waitForFunction(() =>
    [...document.querySelectorAll(".movie-scroller-card img")].some((image) => {
      const bounds = image.getBoundingClientRect();
      return (
        image.complete &&
        image.naturalWidth > 0 &&
        bounds.right > 0 &&
        bounds.bottom > 0 &&
        bounds.left < innerWidth &&
        bounds.top < innerHeight
      );
    }));
  const mobileAfterHydration = await mobileHomePage.evaluate(() => {
    const slot = document.querySelector(".scroller-slot");
    const nextHeading = [...document.querySelectorAll(".section-heading")][1];
    return {
      slotHeight: slot?.getBoundingClientRect().height,
      nextHeadingY: nextHeading?.getBoundingClientRect().y,
    };
  });
  assert.deepEqual(
    mobileAfterHydration,
    mobileBeforeHydration,
    "the reserved mobile scroller slot stays fixed while the original scroller mounts",
  );
  assert.deepEqual(mobileHomeErrors, []);
  if (screenshotDir) {
    await mobileHomePage.screenshot({
      path: join(screenshotDir, "home-mobile-after-hydration.png"),
      fullPage: true,
    });
  }
  await mobileHomePage.close();

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
  const analyticsScript = page.locator(
    'script[src="/_vercel/insights/script.js"]',
  );
  await expect(analyticsScript).toHaveCount(0);
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
  await expect(analyticsScript).toHaveCount(1);
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

  const cityShowtimesPage = await browser.newPage({ javaScriptEnabled: false });
  await cityShowtimesPage.goto(`${baseUrl}/showtimes/jerusalem`);
  assert.equal(
    await cityShowtimesPage
      .getByRole("heading", { name: "New Releases in Jerusalem", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await cityShowtimesPage
      .locator('link[rel="canonical"]')
      .getAttribute("href"),
    "https://seret.site/showtimes/jerusalem",
  );
  assert.equal(await cityShowtimesPage.locator('a[href="/Ab1"]').count(), 1);
  await cityShowtimesPage.close();

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

  const hydratedPublicRouteCases = [
    ["/showtimes", "SSR Test Movie"],
    ["/showtimes/jerusalem", "SSR Test Movie"],
    [`/c/${cinemaIdentity.id}`, cinemaIdentity.displayName],
  ];
  for (const [pathname, expectedContent] of hydratedPublicRouteCases) {
    const hydratedPage = await browser.newPage({ reducedMotion: "reduce" });
    const { showtimeCity, publicationRevision } = makeBootstrap(pathname);
    const nextShowtimeDate = showtimeCity
      ? addCalendarDays(showtimeCity.endDate, 1)
      : null;
    const routeHydrationErrors = [];
    hydratedPage.on("pageerror", (error) =>
      routeHydrationErrors.push(error.message));
    hydratedPage.on("console", (message) => {
      if (/hydration|did not match|server rendered/i.test(message.text())) {
        routeHydrationErrors.push(message.text());
      }
    });
    await hydratedPage.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "images.example.test") {
        await route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: posterFixture,
        });
        return;
      }
      await route.continue();
    });
    if (showtimeCity && nextShowtimeDate) {
      await hydratedPage.route("**/api/v1/showtimes?*", (route) => {
        const { searchParams } = new URL(route.request().url());
        assert.equal(searchParams.get("city"), showtimeCity.city);
        assert.equal(searchParams.get("startDate"), nextShowtimeDate);
        assert.ok(searchParams.get("endDate") >= nextShowtimeDate);
        return route.fulfill({
          headers: { [PUBLICATION_REVISION_HEADER]: publicationRevision },
          json: {
            data: {
              showtimes: [
                {
                  ...showtimeCity.showtimes[0],
                  dateOfShowing: nextShowtimeDate,
                },
              ],
            },
            error: null,
          },
        });
      });
    }
    await hydratedPage.goto(`${baseUrl}${pathname}`, { waitUntil: "load" });
    await hydratedPage
      .getByText(expectedContent, { exact: true })
      .first()
      .waitFor({ state: "visible" });
    await hydratedPage.waitForTimeout(100);
    assert.equal(
      await hydratedPage.locator('a[href="/Ab1"]').count(),
      1,
      `${pathname} retains its server-rendered movie link after hydration`,
    );
    if (nextShowtimeDate) {
      const days = hydratedPage
        .getByRole("radiogroup", { name: "Choose showtime day" })
        .getByRole("radio");
      await expect(days.nth(7)).toBeEnabled();
      for (let day = 0; day < 6; day += 1) {
        await days.nth(day).press("ArrowRight");
      }
      await days.nth(7).click();
      await expect(days.nth(7)).toHaveAttribute("aria-checked", "true");
      await expect(
        hydratedPage
          .locator(`[data-showtime-date="${nextShowtimeDate}"]`)
          .getByRole("link", { name: /23:59 showtime/ }),
      ).toBeVisible();
    }
    assert.deepEqual(
      routeHydrationErrors,
      [],
      `${pathname} hydrates from the same public route component tree`,
    );
    await hydratedPage.close();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())));
}

console.log(
  "Built browser SSR smoke passed with JavaScript disabled and after hydration.",
);
