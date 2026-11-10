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

    if (
      url.hostname === "basemaps.cartocdn.com" &&
      url.pathname.endsWith("/style.json")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      });
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
  tmdbId = "9100001",
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
      tmdbId,
    })}`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data: { showtimes: Array<{ cinema: string; dateOfShowing: string }> };
  };
  const fixture =
    body.data.showtimes.find((row) =>
      row.cinema.startsWith("Development Cinema ")) ?? body.data.showtimes[0];
  if (!fixture) {
    throw new Error(`No seeded showtime fixture was found for ${city}.`);
  }
  return fixture.dateOfShowing;
}

async function getFarFixtureShowtimeRows(page: Page, tmdbId: string) {
  const today = getJerusalemCinemaDate(new Date());
  const startDate = addCalendarDays(today, 70);
  const endDate = addCalendarDays(today, 80);
  if (!startDate || !endDate) {
    throw new Error("Could not calculate the far-ahead browser fixture range.");
  }

  const response = await page.request.get(
    `${API_ROOT}showtimes?${new URLSearchParams({
      city: "Tel Aviv",
      startDate,
      endDate,
      tmdbId,
    })}`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    data: {
      showtimes: Array<{
        cinema: string;
        dateOfShowing: string;
        showtime: string;
      }>;
    };
  };
  return body.data.showtimes.filter((row) =>
    row.cinema.startsWith("Development Cinema "));
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
    page.getByRole("link", {
      name: "Open Dev Catalog Film movie page",
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
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://seret.site/D01",
  );

  expect(
    requests.some((request) => request.endsWith("/catalog/now-playing")),
  ).toBe(true);
  expect(
    requests.some((request) => request.endsWith("/catalog/coming-soon")),
  ).toBe(true);
  expect(requests.some((request) => request.includes("/rest/v1/"))).toBe(false);

  await page.goBack();
  await expect(page).toHaveURL(/\/movies$/);
  await expect(
    page.getByRole("link", {
      name: "Open Dev Catalog Film movie page",
    }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/D01/);
  await expect(
    page.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();

  const shortLinkPage = await page.context().newPage();
  await blockExternalServices(shortLinkPage);
  await shortLinkPage.goto("/D01");
  await expect(
    shortLinkPage.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await shortLinkPage.close();
});

test("nationwide cinematheque search leaves the existing cinema page unchanged", async ({
  page,
}) => {
  const requests = addApiRequestCapture(page);
  await page.goto("/movies");

  await page.getByRole("button", { name: "Search movies" }).click();
  await page
    .getByRole("searchbox", { name: "Search movies" })
    .fill("Dev Cinematheque Film");

  const result = page.getByRole("button", { name: /Dev Cinematheque Film/ });
  await expect(result).toBeVisible();
  await expect(result.getByText("Cinematheque", { exact: true })).toBeVisible();
  expect(await result.count()).toBe(1);

  const nationwideRequest = requests.find((request) =>
    request.startsWith("GET /api/v1/cinematheques?"));
  expect(nationwideRequest).toBeDefined();
  const nationwideParams = new URLSearchParams(
    nationwideRequest!.split("?", 2)[1],
  );
  expect(nationwideParams.get("city")).toBeNull();
  expect(nationwideParams.get("endDate")).toBeTruthy();

  await result.click();
  await expect(page).toHaveURL(/\/cinematheques$/);
  await expect(
    page.getByRole("heading", { name: "Cinematheque Showtimes" }),
  ).toBeVisible();
  await expect(page.locator(".cinematheques-focus-controls")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Development Cinematheque" }),
  ).toBeVisible();
});

test("cinematheque showings appear after commercial cinemas in movie showtimes", async ({
  page,
}, testInfo) => {
  const database = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  const target = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (
    !["localhost", "127.0.0.1", "::1"].includes(target.hostname) ||
    target.pathname !== "/kartiseret_test"
  ) {
    throw new Error("Local disposable database required");
  }

  const tmdbId = 9201002;
  const movieCode = "Wh9";
  const title = "Wild Horse Nine";
  await database.connect();
  try {
    const dateResult = await database.query<{ date: string }>(
      "SELECT to_char(CURRENT_DATE + 14, 'YYYY-MM-DD') AS date",
    );
    const fixtureDate = dateResult.rows[0]?.date;
    if (!fixtureDate) throw new Error("Could not calculate fixture date.");

    await database.query(
      `INSERT INTO public."finalMovies"
        (tmdb_id, english_title, release_year, runtime, popularity, genres, solo_update)
       VALUES ($1, $2, 2026, 117, 100, ARRAY['Comedy', 'Crime', 'Thriller'], false)`,
      [tmdbId, title],
    );
    await database.query(
      `INSERT INTO public."finalThequeMovies"
        (tmdb_id, english_title, release_year, genres, solo_update)
       VALUES ($1, $2, 2026, ARRAY['Comedy', 'Crime', 'Thriller'], false)`,
      [tmdbId, title],
    );
    await database.query(
      `INSERT INTO public."movieCodes" (tmdb_id, movie_code)
       VALUES ($1, $2)`,
      [tmdbId, movieCode],
    );

    const commercialShowtimes = [
      ["Yes Planet", "10:00", "https://tickets.example/yes-planet"],
      ["Cinema City", "11:30", "https://tickets.example/cinema-city"],
      ["Lev Cinema", "14:00", "https://tickets.example/lev-cinema"],
    ];
    for (const [cinema, showtime, href] of commercialShowtimes) {
      await database.query(
        `INSERT INTO public."finalShowtimes"
          (tmdb_id, english_title, cinema, screening_city, date_of_showing,
           showtime, english_href, screening_tech, screening_type)
         VALUES ($1, $2, $3, 'Jerusalem', $4, $5, $6, '2D', 'Regular')`,
        [tmdbId, title, cinema, fixtureDate, showtime, href],
      );
    }

    const cinemathequeShowtimes = [
      [
        "Jerusalem Cinematheque",
        "16:00",
        "https://tickets.example/jerusalem-cinematheque",
        "2D",
        "Regular",
      ],
      [
        "Sam Spiegel Cinema",
        "18:00",
        "https://tickets.example/sam-spiegel",
        "IMAX",
        "Regular",
      ],
    ];
    for (const [
      cinema,
      showtime,
      href,
      screeningTech,
      screeningType,
    ] of cinemathequeShowtimes) {
      await database.query(
        `INSERT INTO public."finalTheques"
          (tmdb_id, english_title, screening_city, date_of_showing, cinema,
           showtime, english_href, screening_tech, screening_type, run_id)
         VALUES ($1, $2, 'Jerusalem', $3, $4, $5, $6, $7, $8, 9100000)`,
        [
          tmdbId,
          title,
          fixtureDate,
          cinema,
          showtime,
          href,
          screeningTech,
          screeningType,
        ],
      );
    }

    await page.goto("/movies");
    await page.getByRole("button", { name: "Search movies" }).click();
    await page.getByRole("searchbox", { name: "Search movies" }).fill(title);
    const result = page
      .locator("button.movie-search-result")
      .filter({ hasText: title });
    await expect(result).toHaveCount(2);
    const regularResult = result.filter({ hasText: "Now Playing" });
    const cinemathequeResult = result.filter({ hasText: "Cinematheque" });
    await expect(regularResult).toBeVisible();
    await expect(regularResult.getByText("Cinematheque")).toHaveCount(0);
    await expect(
      cinemathequeResult.getByText("Cinematheque", { exact: true }),
    ).toBeVisible();
    await page.getByRole("dialog", { name: "Search movies" }).screenshot({
      path: testInfo.outputPath("separate-search-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(regularResult).toBeVisible();
    await expect(cinemathequeResult).toBeVisible();
    await page.getByRole("dialog", { name: "Search movies" }).screenshot({
      path: testInfo.outputPath("separate-search-mobile.png"),
    });
    await cinemathequeResult.click();
    await expect(page).toHaveURL(/\/cinematheques$/);
    await expect(
      page.getByRole("heading", { name: "Cinematheque Showtimes" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Search movies" }).click();
    await page.getByRole("searchbox", { name: "Search movies" }).fill(title);
    await page
      .getByRole("button", { name: `${title} Now Playing • 2026` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${movieCode}`));
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });

    const showtimeDate = await getFixtureShowtimeDate(
      page,
      "Jerusalem",
      String(tmdbId),
    );
    await page.goto("/showtimes");
    const dateButton = page.getByRole("radio", {
      name: new RegExp(
        escapeRegularExpression(dateCalendarLabel(showtimeDate)),
      ),
    });
    await expect(dateButton).toBeVisible();
    await dateButton.scrollIntoViewIfNeeded();
    await dateButton.click();

    const movieRow = page.locator(".all-showtimes-movie-row").filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
    await expect(movieRow).toBeVisible();
    const venueNames = movieRow.locator(
      ".details-theater-name > span:last-child",
    );
    await expect(venueNames).toHaveText([
      "Yes Planet",
      "Cinema City",
      "Lev Cinema",
      "Jerusalem Cinematheque",
      "Sam Spiegel Cinema",
    ]);

    const venueDots = movieRow.locator(".details-theater-dot");
    await expect(venueDots.nth(3)).toHaveCSS(
      "background-color",
      "rgb(49, 162, 109)",
    );
    await expect(venueDots.nth(4)).toHaveCSS(
      "background-color",
      "rgb(118, 201, 159)",
    );
    await expect(
      movieRow.getByRole("link", {
        name: /Open Wild Horse Nine 18:00 showtime at Sam Spiegel Cinema/,
      }),
    ).toHaveAttribute("href", "https://tickets.example/sam-spiegel");
    await expect(movieRow.getByText("IMAX", { exact: true })).toBeVisible();

    await movieRow.scrollIntoViewIfNeeded();
    await movieRow.screenshot({
      path: testInfo.outputPath("combined-showtimes-desktop.png"),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileWidth = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(mobileWidth.document).toBeLessThanOrEqual(mobileWidth.viewport + 1);
    await movieRow.screenshot({
      path: testInfo.outputPath("combined-showtimes-mobile.png"),
    });

    await page.getByRole("button", { name: "Filter showtimes" }).click();
    const filterDialog = page.getByRole("dialog", { name: "Showtime filters" });
    const filmFilter = filterDialog.getByRole("button", {
      name: "IMAX",
      exact: true,
    });
    await expect(filmFilter).toBeVisible();
    await filmFilter.click();
    await expect(venueNames).toHaveText([
      "Yes Planet",
      "Cinema City",
      "Lev Cinema",
      "Jerusalem Cinematheque",
    ]);
    await filmFilter.click();
    await expect(venueNames).toHaveText([
      "Yes Planet",
      "Cinema City",
      "Lev Cinema",
      "Jerusalem Cinematheque",
      "Sam Spiegel Cinema",
    ]);

    await page.goto(`/${movieCode}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const movieDateButton = page.getByRole("radio", {
      name: new RegExp(
        escapeRegularExpression(dateCalendarLabel(showtimeDate)),
      ),
    });
    await expect(movieDateButton).toBeVisible();
    await movieDateButton.scrollIntoViewIfNeeded();
    await movieDateButton.click();
    const detailsDayPanel = page.locator(".details-day-panel");
    await expect(detailsDayPanel).toHaveAttribute(
      "data-showtime-date",
      showtimeDate,
    );
    const detailVenueNames = detailsDayPanel.locator(
      ".details-theater-name > span:last-child",
    );
    await expect(detailVenueNames).toHaveText([
      "Yes Planet",
      "Cinema City",
      "Lev Cinema",
      "Jerusalem Cinematheque",
      "Sam Spiegel Cinema",
    ]);
    await expect(
      detailsDayPanel.locator(".details-theater-dot").nth(3),
    ).toHaveCSS("background-color", "rgb(49, 162, 109)");
    await expect(
      detailsDayPanel.getByRole("link", {
        name: /Open Wild Horse Nine 18:00 showtime at Sam Spiegel Cinema/,
      }),
    ).toHaveAttribute("href", "https://tickets.example/sam-spiegel");
    await page.locator(".movie-page-card").screenshot({
      path: testInfo.outputPath("movie-detail-showtimes-desktop.png"),
    });
  } finally {
    await database.query(
      'DELETE FROM public."finalTheques" WHERE tmdb_id = $1',
      [tmdbId],
    );
    await database.query(
      'DELETE FROM public."finalShowtimes" WHERE tmdb_id = $1',
      [tmdbId],
    );
    await database.query('DELETE FROM public."movieCodes" WHERE tmdb_id = $1', [
      tmdbId,
    ]);
    await database.query(
      'DELETE FROM public."finalThequeMovies" WHERE tmdb_id = $1',
      [tmdbId],
    );
    await database.query(
      'DELETE FROM public."finalMovies" WHERE tmdb_id = $1',
      [tmdbId],
    );
    await database.end();
  }
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

  const citySelector = page.getByRole("button", {
    name: "Open city selector. Current city: Jerusalem",
  });
  await citySelector.last().click();
  const cityDialog = page.getByRole("dialog");
  await expect(cityDialog).toBeVisible();
  const cityListButton = cityDialog.getByRole("button", {
    name: "Open city list",
  });
  await expect(cityListButton).toBeEnabled();
  await cityListButton.click();
  await cityDialog.getByRole("option", { name: "Tel Aviv" }).click();
  await expect(
    page.getByRole("region", { name: "All showtimes in Tel Aviv" }),
  ).toBeVisible();
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
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://seret.site/D01",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    `https://seret.site/${routeCode}`,
  );
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

test("a far-ahead movie link keeps repeated yesterday/tomorrow navigation working", async ({
  page,
}) => {
  const requests = addApiRequestCapture(page);
  const fixtureRows = await getFarFixtureShowtimeRows(page, "9100001");
  const linkedShowing = fixtureRows.find((row) => row.showtime === "19:30");
  expect(linkedShowing).toBeTruthy();
  const linkedDate = linkedShowing!.dateOfShowing;
  const yesterday = addCalendarDays(linkedDate, -1)!;
  const tomorrow = addCalendarDays(linkedDate, 1)!;
  const routeCode = encodeMovieRouteCode({
    movieCode: "D01",
    cityCode: "l",
    dateCode: encodeDateCode(linkedDate)!,
    filterMask: 45120,
    mode: "share",
  })!;

  await page.goto(`/${routeCode}?date=${linkedDate}`);
  await expect(
    page.getByRole("heading", { name: "Dev Catalog Film" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Dev Catalog Film showtimes in Tel Aviv"),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", {
      name: new RegExp(escapeRegularExpression(dateCalendarLabel(linkedDate))),
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".details-day-panel")).toHaveAttribute(
    "data-showtime-date",
    linkedDate,
  );
  await expect(page.getByText("19:30", { exact: true })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("radio", {
      name: new RegExp(escapeRegularExpression(dateCalendarLabel(linkedDate))),
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".details-day-panel")).toHaveAttribute(
    "data-showtime-date",
    linkedDate,
  );
  await expect(page.getByText("19:30", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Filter showtimes" }).click();
  const filters = page.getByRole("dialog", { name: "Showtime filters" });
  await expect(
    filters.getByRole("button", { name: "VIP", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    filters.getByRole("button", { name: "3D", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    filters.getByRole("button", { name: "IMAX", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");

  for (const date of [yesterday, linkedDate, tomorrow, linkedDate, yesterday]) {
    const dateButton = page.getByRole("radio", {
      name: new RegExp(escapeRegularExpression(dateCalendarLabel(date))),
    });
    await expect(dateButton).toBeVisible();
    await dateButton.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("date"))
      .toBe(date);
    await expect(page.locator(".details-day-panel")).toHaveAttribute(
      "data-showtime-date",
      date,
    );
    await expect(dateButton).toHaveAttribute("aria-checked", "true");
    const expectedTime =
      date === yesterday ? "18:30" : date === tomorrow ? "20:30" : "19:30";
    await expect(page.getByText(expectedTime, { exact: true })).toBeVisible();
  }

  const showtimeRequests = requests
    .filter((request) => request.includes("/showtimes?"))
    .map((request) => new URLSearchParams(request.split("?", 2)[1]));
  for (const date of [yesterday, linkedDate, tomorrow]) {
    expect(
      showtimeRequests.some(
        (query) =>
          query.get("city") === "Tel Aviv" &&
          query.get("tmdbId") === "9100001" &&
          (query.get("startDate") ?? "") <= date &&
          (query.get("endDate") ?? "") >= date,
      ),
      `expected a targeted showtime fetch covering ${date}`,
    ).toBe(true);
  }
});

test("a coming-soon movie with future screenings accepts the selected date route", async ({
  page,
}) => {
  const fixtureRows = await getFarFixtureShowtimeRows(page, "9100011");
  const linkedShowing = fixtureRows[0];
  expect(linkedShowing).toBeTruthy();
  const linkedDate = linkedShowing!.dateOfShowing;
  const routeCode = encodeMovieRouteCode({
    movieCode: "D11",
    cityCode: "l",
    dateCode: encodeDateCode(linkedDate)!,
    filterMask: 45120,
    mode: "share",
  })!;

  await page.goto(`/${routeCode}?date=${linkedDate}`);
  await expect(
    page.getByRole("heading", { name: "Dev Coming Soon" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Dev Coming Soon showtimes in Tel Aviv"),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", {
      name: new RegExp(escapeRegularExpression(dateCalendarLabel(linkedDate))),
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".details-day-panel")).toHaveAttribute(
    "data-showtime-date",
    linkedDate,
  );
  await expect(page.getByText("19:30", { exact: true })).toBeVisible();
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
      page.getByRole("link", { name: "Open PR4 old film movie page" }),
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
