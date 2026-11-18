import { readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";

const [origin, label, profile, rounds, ...routes] = process.argv.slice(2);
const count = Number(rounds);
if (
  !origin ||
  !label ||
  !["desktop", "mobile", "no-js"].includes(profile) ||
  !Number.isInteger(count) ||
  count < 1 ||
  !routes.length
) {
  throw new Error(
    "Usage: node scripts/measure-public-browser.mjs ORIGIN BUILD desktop|mobile|no-js COUNT /path [...]",
  );
}
const base = new URL(origin);
const cookieFile = process.env.KARTISERET_MEASURE_COOKIE_FILE;
const cookies = cookieFile
  ? (await readFile(cookieFile, "utf8")).split(/\r?\n/).flatMap((line) => {
      const [domain, , path, secure, expires, name, value] = line
        .replace(/^#HttpOnly_/, "")
        .split("\t");
      if (!name || domain.replace(/^\./, "") !== base.hostname) return [];
      return [
        {
          domain,
          path,
          secure: secure === "TRUE",
          expires: Number(expires) || -1,
          httpOnly: line.startsWith("#HttpOnly_"),
          name,
          value,
        },
      ];
    })
  : [];

const browser = await chromium.launch();
try {
  for (let iteration = 1; iteration <= count; iteration += 1) {
    for (const route of routes) {
      const url = new URL(route, base);
      if (url.origin !== base.origin)
        throw new Error("Routes must stay on the requested origin.");
      const context = await browser.newContext({
        ...(profile === "mobile"
          ? devices["Pixel 7"]
          : { viewport: { width: 1366, height: 768 } }),
        javaScriptEnabled: profile !== "no-js",
      });
      const timestamp = new Date().toISOString();
      try {
        if (cookies.length) await context.addCookies(cookies);
        await context.addInitScript(() => {
          const data = {
            fcp: null,
            lcp: null,
            layoutShift: 0,
            firstUsefulContent: null,
          };
          window.kartiseretMeasurement = data;
          for (const type of [
            "paint",
            "largest-contentful-paint",
            "layout-shift",
          ]) {
            if (!PerformanceObserver.supportedEntryTypes.includes(type))
              continue;
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.name === "first-contentful-paint")
                  data.fcp = entry.startTime;
                if (type === "largest-contentful-paint")
                  data.lcp = entry.startTime;
                if (type === "layout-shift" && !entry.hadRecentInput)
                  data.layoutShift += entry.value;
              }
            }).observe({ type, buffered: true });
          }
          function check() {
            const selector =
              location.pathname === "/"
                ? ".home-poster-row a, .movie-scroller-card"
                : "main a[href*='ticket'], main .showtimes-movie-row, main h1";
            for (const node of document.querySelectorAll(selector)) {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              const image = node.querySelector("img");
              if (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.top < innerHeight &&
                rect.right > 0 &&
                rect.left < innerWidth &&
                style.visibility !== "hidden" &&
                Number(style.opacity) > 0 &&
                (!image || image.naturalWidth > 0)
              ) {
                data.firstUsefulContent = performance.now();
                return;
              }
            }
            if (performance.now() < 15_000) requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
        const page = await context.newPage();
        let pageErrors = 0;
        let hydrationErrors = 0;
        page.on("pageerror", () => {
          pageErrors += 1;
        });
        page.on("console", (message) => {
          if (
            message.type() === "error" &&
            /hydration|did not match/i.test(message.text())
          )
            hydrationErrors += 1;
        });
        const response = await page.goto(url.href, {
          waitUntil: "load",
          timeout: 25000,
        });
        await page.waitForTimeout(1200);
        const browserData = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const resources = performance.getEntriesByType("resource");
          const posterRequests = resources.filter((entry) =>
            /\/poster\/|image\.tmdb\.org\/t\/p\//.test(entry.name),
          );
          const session = resources.find((entry) =>
            entry.name.includes("/api/auth/get-session"),
          );
          return {
            title: document.title,
            canonical: document
              .querySelector('link[rel="canonical"]')
              ?.getAttribute("href"),
            ttfbMs: navigation?.responseStart,
            domContentLoadedMs: navigation?.domContentLoadedEventEnd,
            loadMs: navigation?.loadEventEnd,
            ...window.kartiseretMeasurement,
            resources: resources.length,
            posterRequests: posterRequests.length,
            firstPosterRequestMs: posterRequests.length
              ? Math.min(...posterRequests.map((entry) => entry.startTime))
              : null,
            sessionStartMs: session?.startTime,
            sessionEndMs: session?.responseEnd,
          };
        });
        console.log(
          JSON.stringify({
            timestamp,
            label,
            profile,
            iteration,
            route,
            status: response?.status(),
            cache: response?.headers()["x-vercel-cache"],
            pageErrors,
            hydrationErrors,
            ...browserData,
          }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            timestamp,
            label,
            profile,
            iteration,
            route,
            error: error.name,
          }),
        );
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
