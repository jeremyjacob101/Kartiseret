import { addCalendarDays, encodeDateCode, encodeMovieRouteCode, getJerusalemCinemaDate } from "@kartiseret/contracts/showtime-links";
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const API_ROOT = "/api/v1/";
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  "base64",
);

async function blockExternalServices(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: TRANSPARENT_GIF,
    });
  });
}

function addApiRequestCapture(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(API_ROOT)) {
      requests.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  });
  return requests;
}

async function getFixtureShowtimeDate(
  page: Page,
  city: string,
): Promise<string> {
  const startDate = getJerusalemCinemaDate(new Date());
  const endDate = addCalendarDays(startDate, 30);
  if (!endDate) {
    throw new Error("Could not calculate the browser fixture date range.");
  }

  const response = await page.request.get(
    `${API_ROOT}showtimes?${new URLSearchParams({
      city,
      startDate,
      endDate,
      tmdbId: "9100001",
    })}`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data: { showtimes: Array<{ cinema: string; dateOfShowing: string }> };
  };
  const fixture = body.data.showtimes.find((row) =>
    row.cinema.startsWith("Development Cinema "));
  if (!fixture) {
    throw new Error(`No seeded showtime fixture was found for ${city}.`);
  }
  return fixture.dateOfShowing;
}

function dateCalendarLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year!, month! - 1, day!, 12));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.beforeEach(async ({ page }) => {
  await blockExternalServices(page);
});

test("catalog API supports search and permanent short-code movie details", async ({
  page,
}) => {
  const requests = addApiRequestCapture(page);
  await page.goto("/movies");

  await expect(
    page.getByRole("button", {
      name: "Open Dev Catalog Film in scroller view",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Search movies" }).click();
  await page
    .getByRole("searchbox", { name: "Search movies" })
    .fill("Dev Catalog Film");
  await page
    .getByRole("button", { name: /Dev Catalog Film.*Now Playing/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/D01/);

  expect(
    requests.some((request) => request.endsWith("/catalog/now-playing")),
  ).toBe(true);
  expect(
    requests.some((request) => request.endsWith("/catalog/coming-soon")),
  ).toBe(true);
  expect(requests.some((request) => request.includes("/rest/v1/"))).toBe(false);

  const shortLinkPage = await page.context().newPage();
  await blockExternalServices(shortLinkPage);
  await shortLinkPage.goto("/D01");
  await expect(
    shortLinkPage.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await shortLinkPage.close();
});

test("showtimes browse a real city/date and the active filter changes results", async ({
  page,
}) => {
  const requests = addApiRequestCapture(page);
  const fixtureDate = await getFixtureShowtimeDate(page, "Jerusalem");
  await page.goto("/showtimes");

  await expect(
    page.getByRole("region", { name: "All showtimes in Jerusalem" }),
  ).toBeVisible();
  const dateButton = page.getByRole("radio", {
    name: new RegExp(escapeRegularExpression(dateCalendarLabel(fixtureDate))),
  });
  await expect(dateButton).toBeVisible();
  await dateButton.scrollIntoViewIfNeeded();
  await dateButton.click();

  await expect(
    page.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await expect(page.getByText("20:15", { exact: true })).toBeVisible();
  const showtimeRequests = requests
    .filter((request) => request.includes("/showtimes?"))
    .map((request) => new URLSearchParams(request.split("?", 2)[1] ?? ""));
  expect(showtimeRequests.length).toBeGreaterThan(0);
  expect(showtimeRequests[0]!.get("startDate")).toBe(
    showtimeRequests[0]!.get("endDate"),
  );
  const fixtureRange = showtimeRequests.find((params) => {
    const startDate = params.get("startDate") ?? "";
    const endDate = params.get("endDate") ?? "";
    return (
      params.get("city") === "Jerusalem" &&
      startDate <= fixtureDate &&
      endDate >= fixtureDate
    );
  });
  expect(fixtureRange).toBeDefined();
  const startTime = Date.parse(`${fixtureRange!.get("startDate")}T00:00:00Z`);
  const endTime = Date.parse(`${fixtureRange!.get("endDate")}T00:00:00Z`);
  expect((endTime - startTime) / 86_400_000 + 1).toBeLessThanOrEqual(15);

  await page.getByRole("button", { name: "Filter showtimes" }).click();
  const filterDialog = page.getByRole("dialog", { name: "Showtime filters" });
  const twoDimensionalFilter = filterDialog.getByRole("button", {
    name: "2D",
    exact: true,
  });
  await expect(twoDimensionalFilter).toBeVisible();
  await twoDimensionalFilter.click();
  await expect(
    page.getByText("No Jerusalem showtimes match the active filters"),
  ).toBeVisible();
  await twoDimensionalFilter.click();
  await expect(page.getByText("20:15", { exact: true })).toBeVisible();
});

test("an encoded Tel Aviv share link opens on mobile with targeted showtimes", async ({
  page,
}) => {
  const requests = addApiRequestCapture(page);
  const fixtureDate = await getFixtureShowtimeDate(page, "Tel Aviv");
  const dateCode = encodeDateCode(fixtureDate);
  const routeCode = dateCode
    ? encodeMovieRouteCode({
        movieCode: "D01",
        cityCode: "l",
        dateCode,
        filterMask: 0,
        mode: "share",
      })
    : null;
  expect(routeCode).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${routeCode}`);

  await expect(
    page.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Dev Catalog Film showtimes in Tel Aviv"),
  ).toBeVisible();
  await expect(page.getByText("19:30", { exact: true })).toBeVisible();
  expect(
    requests.some(
      (request) =>
        request.includes("/showtimes?") &&
        request.includes("city=Tel+Aviv") &&
        request.includes(`startDate=${fixtureDate}`) &&
        request.includes("tmdbId=9100001"),
    ),
  ).toBe(true);
});

test("unknown API routes remain JSON 404s instead of returning the SPA", async ({
  request,
}) => {
  const response = await request.get(`${API_ROOT}not-a-route`);
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.text()).not.toContain("<html");
});

test("an open catalog refreshes coherently when publication changes before loading showtimes", async ({
  page,
}) => {
  const database = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  const target = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (
    !["localhost", "127.0.0.1", "::1"].includes(target.hostname) ||
    target.pathname !== "/kartiseret_test"
  )
    throw new Error("Local disposable database required");
  await database.connect();
  const id = 2101000100;
  const cinema = "PR4 browser cinema";
  const fixtureDate = addCalendarDays(getJerusalemCinemaDate(new Date()), 1)!;
  try {
    await database.query(
      "insert into public.\"finalMovies\"(tmdb_id,english_title,release_year,runtime,popularity) values($1,'PR4 old film',2026,90,100)",
      [id],
    );
    await database.query(
      "insert into public.\"movieCodes\"(tmdb_id,movie_code) values($1,'Pr4')",
      [id],
    );
    await database.query(
      "insert into public.\"finalShowtimes\"(tmdb_id,english_title,cinema,screening_city,date_of_showing,showtime,english_href,run_id) values($1,'PR4 old film',$2,'Jerusalem',$3,'20:45','https://tickets.example/pr4',901)",
      [id, cinema, fixtureDate],
    );
    await page.goto("/movies");
    await expect(
      page.getByRole("button", { name: "Open PR4 old film in scroller view" }),
    ).toBeVisible();
    await database.query("begin");
    await database.query(
      "update public.\"finalMovies\" set english_title='PR4 published film' where tmdb_id=$1",
      [id],
    );
    await database.query(
      "update public.\"finalShowtimes\" set english_title='PR4 published film',showtime='21:45' where tmdb_id=$1",
      [id],
    );
    await database.query("commit");
    const changed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/showtimes" &&
        response.status() === 409,
    );
    await page
      .getByRole("button", { name: "All Showtimes", exact: true })
      .click();
    await changed;
    const date = page.getByRole("radio", {
      name: new RegExp(escapeRegularExpression(dateCalendarLabel(fixtureDate))),
    });
    await expect(date).toBeVisible();
    await date.scrollIntoViewIfNeeded();
    await date.click();
    await expect(
      page.getByRole("heading", { name: "PR4 published film" }),
    ).toBeVisible();
    await expect(page.getByText("21:45", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "PR4 old film" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/kartiseret-pr4-publication.png",
      fullPage: true,
    });
  } finally {
    await database.query("rollback");
    await database.query(
      'delete from public."finalShowtimes" where tmdb_id=$1',
      [id],
    );
    await database.query('delete from public."finalMovies" where tmdb_id=$1', [
      id,
    ]);
    await database.query('delete from public."movieCodes" where tmdb_id=$1', [
      id,
    ]);
    await database.end();
  }
});
