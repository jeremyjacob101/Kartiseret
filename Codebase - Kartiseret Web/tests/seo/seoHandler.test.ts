import { addCalendarDays, buildMovieShowtimeShareUrl, getJerusalemCinemaDate } from "@kartiseret/contracts/showtime-links";
import { DEFAULT_SHOWTIME_PREFERENCES } from "@kartiseret/contracts/showtime-preferences";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleMovie } from "../fixtures";

const mocks = vi.hoisted(() => ({
  getMovieCatalog: vi.fn(),
  getCinemathequeData: vi.fn(),
  getCinemaPageData: vi.fn(),
  getMovieByPermanentCode: vi.fn(),
  getMovieShowtimes: vi.fn(),
  getPublicTheaterData: vi.fn(),
  getShowtimeRange: vi.fn(),
  findShowtimeEligibilityCandidates: vi.fn(),
  getProductionPublicDataRepository: vi.fn(),
  withPublicationSnapshot: vi.fn(),
  readHomepageFeatured: vi.fn(),
  renderBuiltPublicApplication: vi.fn(),
  readProductionPagePreferences: vi.fn(),
}));

vi.mock("@kartiseret/server/public-data", () => mocks);
vi.mock("@kartiseret/server/production", () => ({
  readProductionPagePreferences: mocks.readProductionPagePreferences,
}));
vi.mock("@kartiseret/server/public-production", () => ({
  getProductionPublicDataRepository: mocks.getProductionPublicDataRepository,
  getProductionDataRuntime: () => ({ database: { db: {} } }),
}));
vi.mock("@kartiseret/server/homepage-featured", () => ({
  HomepageFeaturedService: class {
    readPublic = mocks.readHomepageFeatured;
  },
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync: () =>
    '<!doctype html><html lang="en"><head><!-- SEO_META_START --><title>base</title><!-- SEO_META_END --></head><body><div id="root"></div></body></html>',
}));
vi.mock("../../server/seo/renderer.js", () => ({
  renderBuiltPublicApplication: mocks.renderBuiltPublicApplication,
}));

const { default: seoHandler } = await import("../../server/seo/handler.js");

const cinema = CINEMA_IDENTITIES.find(
  (identity) => identity.displayName === "Cinema City Jerusalem",
)!;

function createTheater() {
  return {
    city: {
      name: cinema.city,
      altSpellings: [],
      latitude: 31.78,
      longitude: 35.2,
      zoomLayer: 10,
      neighboringCities: [],
    },
    chain: "Cinema City",
    address: "Derech Yitzhak Rabin 10",
    theaterName: cinema.displayName,
    location: cinema.locationKeys[0]!,
    lat: 31.78,
    lng: 35.2,
  };
}

function createResponse() {
  const response = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    send(body: unknown) {
      this.body = String(body);
      return this;
    },
  };
  return response;
}

function createRequest(url: string, query: Record<string, string> = {}) {
  return { url, query, headers: {} as Record<string, string> };
}

function catalog(
  movies: readonly (typeof sampleMovie)[] = [sampleMovie],
  mode: "nowPlaying" | "comingSoon" = "nowPlaying",
) {
  return {
    mode,
    movies: [...movies],
    movieCodesStatus: "ready",
  };
}

function theaterData() {
  return { theaters: [createTheater()], cities: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHomepageFeatured.mockReset().mockResolvedValue(undefined);
  mocks.getProductionPublicDataRepository.mockReset().mockReturnValue({
    findShowtimeEligibilityCandidates: mocks.findShowtimeEligibilityCandidates,
  });
  mocks.findShowtimeEligibilityCandidates.mockReset().mockResolvedValue([]);
  mocks.withPublicationSnapshot.mockImplementation(async (
    _repository: unknown,
    callback: (revision: string) => unknown,
  ) => callback("7"));
  mocks.getMovieCatalog.mockImplementation(async (_repository, mode) =>
    mode === "nowPlaying" ? catalog([sampleMovie], mode) : catalog([], mode));
  mocks.getCinemathequeData.mockResolvedValue({
    movies: [],
    movieCodesStatus: "ready",
    showtimes: [],
  });
  mocks.getMovieByPermanentCode.mockResolvedValue({
    movie: sampleMovie,
    isComingSoon: false,
  });
  mocks.getCinemaPageData.mockResolvedValue({
    id: cinema.id,
    displayName: cinema.displayName,
    city: cinema.city,
    address: "Derech Yitzhak Rabin 10",
    mapUrl: cinema.locationKeys[0],
    latitude: 31.78,
    longitude: 35.2,
    screenings: [],
  });
  mocks.renderBuiltPublicApplication.mockResolvedValue(
    '<div class="ssr-public-content"><h1>Rendered application</h1></div>',
  );
  mocks.getPublicTheaterData.mockResolvedValue(theaterData());
  mocks.getShowtimeRange.mockResolvedValue([]);
  mocks.getMovieShowtimes.mockResolvedValue([]);
});

describe("SEO request handler", () => {
  it("reads homepage featured content before the catalog snapshot pins the pool", async () => {
    const featured = {
      data: {
        lineup: null,
        highlights: [],
        promotions: [],
        ranking: {
          asOf: "2026-11-22",
          localReleaseDates: { "101": "2026-11-20" },
          ticketedUpcomingIds: ["102"],
        },
      },
      error: null,
    };
    mocks.readHomepageFeatured.mockResolvedValue(featured);
    const response = createResponse();

    await seoHandler(
      createRequest("/api/page?path=%2F", { path: "/" }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.readHomepageFeatured).toHaveBeenCalledBefore(
      mocks.withPublicationSnapshot,
    );
    expect(mocks.renderBuiltPublicApplication.mock.calls[0]?.[0]).toMatchObject(
      {
        homepageFeatured: featured,
      },
    );
  });

  it("renders isolated account display state while retaining the anonymous cache path", async () => {
    const readMovieTreatments = vi.fn().mockResolvedValue([]);
    mocks.readProductionPagePreferences.mockImplementation(async (
      cookie: string,
    ) => {
      if (cookie === "invalid") throw new Error("expired");
      return {
        userId: cookie,
        preferences: {
          ratingSources: [],
          location: "Tel Aviv",
          siteColor: cookie === "one" ? "#69b0e2" : "#63ae3d",
          hideReReleases: true,
          showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
        },
        readMovieTreatments,
      };
    });
    async function render(cookie?: string) {
      const response = createResponse();
      const request = createRequest(
        cookie ? "/api/private-page" : "/api/page",
        { path: "/" },
      );
      if (cookie) request.headers.cookie = cookie;
      await seoHandler(request, response as never);
      expect(response.statusCode).toBe(200);
      expect(response.headers.get("content-security-policy")).toBe(
        "frame-ancestors 'none'",
      );
      return response;
    }
    const [first, second, anonymous, expired] = await Promise.all([
      render("one"),
      render("two"),
      render(),
      render("invalid"),
    ]);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(second.headers.get("cache-control")).toBe("private, no-store");
    expect(expired.headers.get("cache-control")).toBe("private, no-store");
    expect(anonymous.headers.get("cache-control")).toContain("s-maxage=60");
    expect(first.body).toContain('data-initial-site-color="#69b0e2"');
    expect(first.body).not.toContain("#63ae3d");
    expect(second.body).toContain('data-initial-site-color="#63ae3d"');
    expect(first.body).toContain('id="kartiseret-display"');
    expect(second.body).toContain('id="kartiseret-display"');
    expect(anonymous.body).not.toContain('id="kartiseret-display"');
    expect(expired.body).not.toContain('id="kartiseret-display"');
    expect(mocks.readProductionPagePreferences).toHaveBeenCalledTimes(3);
    expect(readMovieTreatments).toHaveBeenCalledTimes(2);
  });

  it("allows production crawlers and blocks indexing on Vercel previews", async () => {
    const previousVercelEnvironment = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      const productionResponse = createResponse();
      await seoHandler(
        createRequest("/api/robots", {}),
        productionResponse as never,
      );

      expect(productionResponse.statusCode).toBe(200);
      expect(productionResponse.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(productionResponse.body).toBe(
        "User-agent: *\nAllow: /\nSitemap: https://seret.site/sitemap.xml\n",
      );

      process.env.VERCEL_ENV = "preview";
      const previewResponse = createResponse();
      await seoHandler(
        createRequest("/api/robots", {}),
        previewResponse as never,
      );
      expect(previewResponse.body).toBe("User-agent: *\nDisallow: /\n");
    } finally {
      if (previousVercelEnvironment === undefined) {
        delete process.env.VERCEL_ENV;
      } else {
        process.env.VERCEL_ENV = previousVercelEnvironment;
      }
    }
  });

  it("serves permanent movie HTML with a short canonical and verified cinema links", async () => {
    const date = getJerusalemCinemaDate();
    mocks.getMovieShowtimes.mockResolvedValue([
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: "Jerusalem",
        dateOfShowing: date,
        cinema: "Cinema City",
        showtime: "23:59",
        englishHref: "https://tickets.example.test/showtime",
        hebrewHref: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
    ]);
    const response = createResponse();

    await seoHandler(
      createRequest("/api/movie?routeCode=Ab1", { routeCode: "Ab1" }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(mocks.getMovieCatalog).not.toHaveBeenCalled();
    expect(mocks.renderBuiltPublicApplication.mock.calls[0]?.[0]).toMatchObject(
      {
        catalogs: { nowPlaying: undefined, comingSoon: undefined },
        movieDetail: { movie: sampleMovie, mode: "nowPlaying" },
      },
    );
    expect(mocks.getMovieShowtimes).toHaveBeenCalledOnce();
    expect(mocks.getPublicTheaterData).toHaveBeenCalledOnce();
    expect(response.body).toContain('data-ssr="true"');
    expect(response.body).toContain("Rendered application");
    expect(response.body).not.toContain("seo-content");
    expect(mocks.renderBuiltPublicApplication).toHaveBeenCalledOnce();
  });

  it("keeps the general showtimes SEO Israel-wide while retaining the Jerusalem UI default", async () => {
    const response = createResponse();

    await seoHandler(
      createRequest("/api/page?path=%2Fshowtimes", { path: "/showtimes" }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      "<title>Movie showtimes in Israel — Now Playing | Kartiseret</title>",
    );
    expect(response.body).toContain(
      '<link rel="canonical" href="https://seret.site/showtimes" />',
    );
    const bootstrap = mocks.renderBuiltPublicApplication.mock.calls[0]?.[0];
    expect(bootstrap).toMatchObject({
      pathname: "/showtimes",
      showtimeCity: { city: "Jerusalem" },
    });
  });

  it.each([
    ["/movies", "nowPlaying", "comingSoon"],
    ["/soons", "comingSoon", "nowPlaying"],
  ])("prepares only the requested catalog for %s", async (
    path,
    requested,
    omitted,
  ) => {
    const response = createResponse();
    await seoHandler(createRequest("/api/page", { path }), response as never);

    expect(response.statusCode).toBe(200);
    expect(mocks.getMovieCatalog).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      requested,
    );
    expect(mocks.getPublicTheaterData).not.toHaveBeenCalled();
    const bootstrap = mocks.renderBuiltPublicApplication.mock.calls[0]?.[0];
    expect(bootstrap.catalogs[requested]).toBeDefined();
    expect(bootstrap.catalogs[omitted]).toBeUndefined();
  });

  it("checks national eligibility once without fetching other cities' display rows", async () => {
    const date = addCalendarDays(getJerusalemCinemaDate(), 1)!;
    mocks.findShowtimeEligibilityCandidates.mockResolvedValue([
      {
        tmdbId: Number(sampleMovie.tmdbId),
        screeningCity: "Tel Aviv",
        dateOfShowing: date,
        cinema: "Cinema City",
        showtime: "19:30",
        isCinematheque: false,
      },
    ]);
    const response = createResponse();

    await seoHandler(
      createRequest("/api/page", { path: "/showtimes" }),
      response as never,
    );

    expect(response.headers.get("x-robots-tag")).toBe("index, follow");
    expect(mocks.findShowtimeEligibilityCandidates).toHaveBeenCalledTimes(1);
    expect(mocks.getShowtimeRange).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ city: "Jerusalem" }),
    );
  });

  it("serves city showtimes with local metadata, a self canonical, and seeded listings", async () => {
    const date = addCalendarDays(getJerusalemCinemaDate(), 1)!;
    mocks.getShowtimeRange.mockImplementation(async (_repository, range) =>
      range.city === "Tel Aviv"
        ? [
            {
              tmdbId: sampleMovie.tmdbId,
              screeningCity: "Tel Aviv",
              dateOfShowing: date,
              cinema: "Cinema City",
              showtime: "19:30",
              englishHref: null,
              hebrewHref: null,
              screeningTech: "2D",
              screeningType: "Regular",
              dubLanguage: null,
            },
          ]
        : []);
    const response = createResponse();

    await seoHandler(
      createRequest("/api/page?path=%2Fshowtimes%2Ftel-aviv", {
        path: "/showtimes/tel-aviv",
      }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      "<title>Movie showtimes in Tel Aviv — Now Playing | Kartiseret</title>",
    );
    expect(response.body).toContain(
      '<link rel="canonical" href="https://seret.site/showtimes/tel-aviv" />',
    );
    expect(response.headers.get("x-robots-tag")).toBe("index, follow");
    expect(mocks.renderBuiltPublicApplication.mock.calls[0]?.[0]).toMatchObject(
      {
        pathname: "/showtimes/tel-aviv",
        showtimeCity: {
          city: "Tel Aviv",
          showtimes: [{ screeningCity: "Tel Aviv" }],
        },
      },
    );
  });

  it("returns valid but empty city views as noindex and rejects unknown city slugs", async () => {
    const emptyResponse = createResponse();
    await seoHandler(
      createRequest("/api/page?path=%2Fshowtimes%2Fhaifa", {
        path: "/showtimes/haifa",
      }),
      emptyResponse as never,
    );

    const invalidResponse = createResponse();
    await seoHandler(
      createRequest("/api/page?path=%2Fshowtimes%2Fnot-a-city", {
        path: "/showtimes/not-a-city",
      }),
      invalidResponse as never,
    );

    expect(emptyResponse.statusCode).toBe(200);
    expect(emptyResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(invalidResponse.statusCode).toBe(404);
  });

  it("renders published screenings without inventing booking links", async () => {
    const date = getJerusalemCinemaDate();
    mocks.getMovieShowtimes.mockResolvedValue([
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: "Jerusalem",
        dateOfShowing: date,
        cinema: "Unmapped Cinema",
        showtime: "23:59",
        englishHref: null,
        hebrewHref: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
    ]);
    const response = createResponse();

    await seoHandler(
      createRequest("/api/movie?routeCode=Ab1", { routeCode: "Ab1" }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    const bootstrap = mocks.renderBuiltPublicApplication.mock.calls[0]?.[0];
    expect(bootstrap).toMatchObject({ pathname: "/Ab1" });
    expect(bootstrap?.showtimeCity).toBeUndefined();
    expect(bootstrap?.targetedMovieShowtimes?.showtimes[0]).toMatchObject({
      cinema: "Unmapped Cinema",
      dateOfShowing: date,
      showtime: "23:59",
      englishHref: null,
    });
  });

  it("bootstraps an explicit far-ahead Tel Aviv movie date for direct entry", async () => {
    const today = getJerusalemCinemaDate();
    const date = addCalendarDays(today, 75)!;
    const routeCode = new URL(
      buildMovieShowtimeShareUrl({
        movieCode: "Ab1",
        city: "Tel Aviv",
        date: today,
        filterMask: 45120,
      })!,
    ).pathname.slice(1);
    mocks.getMovieShowtimes.mockResolvedValue([
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: "Tel Aviv",
        dateOfShowing: date,
        cinema: "Cinema City",
        showtime: "19:30",
        englishHref: null,
        hebrewHref: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
    ]);
    const response = createResponse();

    await seoHandler(
      createRequest(`/api/movie?routeCode=${routeCode}&date=${date}`, {
        routeCode,
        date,
      }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    const bootstrap = mocks.renderBuiltPublicApplication.mock.calls[0]?.[0];
    expect(bootstrap?.pathname).toBe(`/${routeCode}?date=${date}`);
    expect(bootstrap?.targetedMovieShowtimes).toMatchObject({
      city: "Tel Aviv",
      date,
      tmdbId: sampleMovie.tmdbId,
    });
  });

  it("serves verified cinema pages with cinematheque screenings and movie shortlinks", async () => {
    const cinemaTheater = CINEMA_IDENTITIES.find(
      (identity) => identity.displayName === "Jerusalem Cinematheque",
    )!;
    const data = {
      ...theaterData(),
      theaters: [
        {
          ...createTheater(),
          chain: "Cinematheque",
          theaterName: cinemaTheater.displayName,
          location: cinemaTheater.locationKeys[0]!,
        },
      ],
    };
    mocks.getPublicTheaterData.mockResolvedValue(data);
    mocks.getCinemaPageData.mockResolvedValue({
      id: cinemaTheater.id,
      displayName: cinemaTheater.displayName,
      city: cinemaTheater.city,
      address: "1 Cinema Street",
      mapUrl: cinemaTheater.locationKeys[0],
      latitude: 31.78,
      longitude: 35.2,
      screenings: [
        {
          movie: sampleMovie,
          screening: {
            tmdbId: sampleMovie.tmdbId,
            screeningCity: "Jerusalem",
            dateOfShowing: addCalendarDays(getJerusalemCinemaDate(), 1)!,
            cinema: "Jerusalem Cinematheque",
            showtime: "20:00",
            englishHref: null,
            hebrewHref: null,
            screeningTech: "35mm",
            screeningType: "Film",
            dubLanguage: null,
          },
        },
      ],
    });
    const response = createResponse();

    await seoHandler(
      createRequest(`/api/cinema?cinemaId=${cinemaTheater.id}`, {
        cinemaId: cinemaTheater.id,
      }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.getCinemaPageData).toHaveBeenCalledWith(
      expect.anything(),
      cinemaTheater.id,
      expect.any(Date),
      expect.any(Promise),
    );
    expect(mocks.getMovieCatalog).toHaveBeenCalledTimes(2);
    expect(mocks.renderBuiltPublicApplication.mock.calls[0]?.[0]).toMatchObject(
      {
        pathname: `/c/${cinemaTheater.id}`,
        cinema: { displayName: cinemaTheater.displayName },
      },
    );
  });

  it("does not publish cinematheque-only movie codes as public movie links", async () => {
    mocks.getMovieCatalog.mockImplementation(async (_repository, mode) =>
      catalog([], mode));
    mocks.getCinemathequeData.mockResolvedValue({
      movies: [sampleMovie],
      movieCodesStatus: "ready",
      showtimes: [],
    });
    const response = createResponse();

    await seoHandler(
      createRequest("/api/page?path=%2Fcinematheques", {
        path: "/cinematheques",
      }),
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.body).not.toContain('href="/Ab1"');
  });

  it("returns uncached 404s for invalid short codes and unknown cinema identities", async () => {
    const invalidMovie = createResponse();
    await seoHandler(
      createRequest("/api/movie?routeCode=%3F%3F", { routeCode: "??" }),
      invalidMovie as never,
    );
    const unknownCinema = createResponse();
    await seoHandler(
      createRequest("/api/cinema?cinemaId=Unknown12345", {
        cinemaId: "Unknown12345",
      }),
      unknownCinema as never,
    );

    expect(invalidMovie.statusCode).toBe(404);
    expect(invalidMovie.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(invalidMovie.headers.get("cache-control")).toBe("no-store");
    expect(unknownCinema.statusCode).toBe(404);
  });

  it("returns temporary failures without caching when public data is unavailable", async () => {
    mocks.getProductionPublicDataRepository.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const response = createResponse();

    await seoHandler(
      createRequest("/api/movie?routeCode=Ab1", { routeCode: "Ab1" }),
      response as never,
    );

    expect(response.statusCode).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("builds a fixed-origin sitemap without request-host or encoded selection URLs", async () => {
    const date = addCalendarDays(getJerusalemCinemaDate(), 1)!;
    const laterDate = addCalendarDays(getJerusalemCinemaDate(), 20)!;
    mocks.findShowtimeEligibilityCandidates.mockResolvedValue(
      [cinema.city, "Tel Aviv"].map((city) => ({
        tmdbId: Number(sampleMovie.tmdbId),
        screeningCity: city,
        dateOfShowing: city === cinema.city ? date : laterDate,
        cinema: cinema.displayName,
        showtime: "19:30",
        isCinematheque: false,
      })),
    );
    const response = createResponse();
    const request = createRequest("/api/sitemap", {});
    request.headers.host = "attacker.example";

    await seoHandler(request, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.body).toContain("https://seret.site/Ab1");
    expect(response.body).toContain("https://seret.site/showtimes/jerusalem");
    expect(response.body).not.toContain(
      "https://seret.site/showtimes/tel-aviv",
    );
    expect(response.body).toContain(`https://seret.site/c/${cinema.id}`);
    expect(response.body).not.toContain("attacker.example");
    expect(response.body).not.toContain("?filter=");
  });

  it("returns an uncached sitemap failure when movie code data is incomplete", async () => {
    mocks.getMovieCatalog.mockResolvedValue({
      movies: [],
      movieCodesStatus: "failed",
    });
    const response = createResponse();

    await seoHandler(createRequest("/api/sitemap", {}), response as never);

    expect(response.statusCode).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the permanent short movie URL as encoded-page canonical", async () => {
    const response = createResponse();
    const encodedUrl = buildMovieShowtimeShareUrl({
      movieCode: "Ab1",
      city: "Haifa",
      date: addCalendarDays(getJerusalemCinemaDate(), 2)!,
      filterMask: 1,
    })!;
    const encodedCode = new URL(encodedUrl).pathname.slice(1);

    await seoHandler(
      createRequest(`/api/movie?routeCode=${encodedCode}`, {
        routeCode: encodedCode,
      }),
      response as never,
    );

    expect(mocks.getMovieByPermanentCode).toHaveBeenCalledWith(
      expect.anything(),
      "Ab1",
    );
  });
});
