import { getMovieCatalog, getCinemathequeData, getCinemaPageData, getMovieByPermanentCode, getMovieShowtimes, getPublicTheaterData, getShowtimeRange, withPublicationSnapshot, type PublicCinemaPageContext } from "@kartiseret/server/public-data";
import { privatePageDisplaySchema, publicPageBootstrapSchema, type PrivatePageDisplay, type PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { PostgresPublicRouteRegistry, attachMoviePublicRouteCodes, moviePublicRouteInput, resolveLegacyPublicRoute } from "@kartiseret/server/page-routes";
import { createShowtimeInclusionPredicate, getCinemaDayDate, shouldIncludeShowtime, SHOWTIME_TIME_ZONE } from "@kartiseret/contracts/showtime-day";
import { injectRenderedApplication, injectSeoPage, SITE_ORIGIN, buildSitemapXml, safeHttpUrl, getRequestOrigin } from "./renderHtml.js";
import { cinemaIdForLocation, findCinemaIdentityForScreening, getCinemaIdentityById } from "./identities.js";
import { getPublicRouteRenderPath, isSecureEmailActionPath } from "@kartiseret/contracts/public-routes";
import { getShowtimesCityFromPath, getShowtimesCityPath } from "@kartiseret/contracts/showtime-routes";
import { timeCatalogStage, timeCatalogStageSync } from "@kartiseret/server/catalog-timing";
import { getProductionPublicDataRepository } from "@kartiseret/server/public-production";
import { filterShowtimeRows, resolvePreviewRouteSelection } from "../og/previewData.js";
import { DEFAULT_LOCATION, type AppLocation } from "@kartiseret/contracts/preferences";
import { getProductionDataRuntime } from "@kartiseret/server/public-production";
import { HomepageFeaturedService } from "@kartiseret/server/homepage-featured";
import { socialPreviewImageUrl } from "@kartiseret/contracts/social-preview";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { parseMovieRouteCode } from "@kartiseret/contracts/showtime-links";
import type { VercelRequest, VercelResponse } from "../og/vercelTypes.js";
import type { PublicShowtime } from "@kartiseret/contracts/public-data";
import type { PublicRoute } from "@kartiseret/contracts/public-routes";
import { ALL_LOCATIONS } from "@kartiseret/contracts/preferences";
import { renderBuiltPublicApplication } from "./renderer.js";
import { logErrorSafely } from "@kartiseret/server/logging";
import type { Movie } from "@kartiseret/contracts/movies";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRIVATE_PAGE_CACHE = "private, no-store";
export const PUBLIC_CATALOG_CACHE_TAG = "public-catalog";
const PUBLIC_CATALOG_CACHE_TTL_SECONDS = 300;
const PUBLIC_CATALOG_STALE_SECONDS = 300;
const PRIVATE_DISPLAY_BUDGET_MS = 1200;
let preferenceReader:
  Promise<typeof import("@kartiseret/server/production")> | undefined;

async function readPrivateDisplay(cookie: string) {
  return timeCatalogStage("page_preferences", async () => {
    preferenceReader ??= import("@kartiseret/server/production").catch((
      error,
    ) => {
      preferenceReader = undefined;
      throw error;
    });
    const { readProductionPagePreferences } = await preferenceReader;
    return readProductionPagePreferences(cookie);
  });
}

function getPageMovieIds(bootstrap: PublicPageBootstrap): string[] {
  const ids = new Set<string>();
  for (const catalog of Object.values(bootstrap.catalogs)) {
    for (const movie of catalog?.movies ?? []) ids.add(movie.tmdbId);
  }
  if (bootstrap.movieDetail) ids.add(bootstrap.movieDetail.movie.tmdbId);
  for (const { movie } of bootstrap.cinema?.screenings ?? [])
    ids.add(movie.tmdbId);
  for (const movie of bootstrap.cinematheques?.data.movies ?? [])
    ids.add(movie.tmdbId);
  return [...ids].filter((id) => /^[0-9]{1,12}$/.test(id));
}
const PUBLIC_PAGE_DEADLINE_MS = 25_000;
const SSR_RENDER_BUDGET_MS = 12_000;
const CLIENT_ONLY_PUBLIC_PATHS = new Set([
  "/user",
  ...["showtimes", "discovery", "appearance", "notifications", "account"].map(
    (tab) => `/user?tab=${tab}`,
  ),
  "/user?linked=1",
  "/user?linkError=1",
  "/support",
  "/accessibility",
  "/privacy",
  "/terms",
  "/attribution",
  "/third-party-licenses.txt",
  "/reset-password",
]);
const PUBLIC_PAGE_LINK_PATHS = [
  "/",
  "/movies",
  "/soons",
  "/showtimes",
  "/cinematheques",
  "/user",
  ...["showtimes", "discovery", "appearance", "notifications", "account"].map(
    (tab) => `/user?tab=${tab}`,
  ),
  "/user?linked=1",
  "/user?linkError=1",
  "/support",
  "/accessibility",
  "/privacy",
  "/terms",
  "/attribution",
  "/third-party-licenses.txt",
  "/reset-password",
  "/?verified=1",
  "/?accountDeleted=1",
  "/?authError=1",
];

const PUBLIC_PAGE_CALLBACK_QUERY_KEYS: Record<string, readonly string[]> = {
  "/": ["verified", "accountDeleted", "authError", "error"],
  "/user": ["tab", "linked", "linkError", "error"],
};

function getPublicPageRequestPath(
  path: string,
  query: VercelRequest["query"],
): string {
  const allowedKeys = PUBLIC_PAGE_CALLBACK_QUERY_KEYS[path];
  if (!allowedKeys || path.includes("?")) return path;

  const search = new URLSearchParams();
  for (const key of allowedKeys) {
    const value = query[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === "string") search.append(key, item);
    }
  }
  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function createPublicRoutePathMap(
  registry: PostgresPublicRouteRegistry,
): Promise<Record<string, string>> {
  const destinations = [
    ...PUBLIC_PAGE_LINK_PATHS.map((path) => ({
      path,
      input: resolveLegacyPublicRoute(path),
    })),
    ...ALL_LOCATIONS.map((city) => {
      const path = getShowtimesCityPath(city);
      return { path, input: resolveLegacyPublicRoute(path) };
    }),
    ...CINEMA_IDENTITIES.map(({ id }) => ({
      path: `/__cinema/${id}`,
      input: {
        destinationKey: `cinema:${id}`,
        kind: "cinema" as const,
        destinationId: id,
      },
    })),
  ].filter(
    (
      destination,
    ): destination is {
      path: string;
      input: NonNullable<ReturnType<typeof resolveLegacyPublicRoute>>;
    } => destination.input !== null,
  );
  const inputs = destinations.map(({ input }) => input);
  const routes = await registry.getOrCreateMany(inputs);
  return Object.fromEntries(
    destinations.map(({ path }, index) => [path, `/${routes[index]!.code}`]),
  );
}

const JERUSALEM_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHOWTIME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getJerusalemParts(instant: Date) {
  const parts = JERUSALEM_CLOCK.formatToParts(instant);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
  };
}

function getNextCinemaDayBoundary(instant: Date): Date {
  const cinemaDate = getCinemaDayDate(instant);
  const nextDate = dayOffset(cinemaDate, 1);
  const [year, month, day] = nextDate.split("-").map(Number);
  const localBoundaryAsUtc = Date.UTC(year!, month! - 1, day!, 1, 5);
  const offsetReference = new Date(localBoundaryAsUtc - 12 * 60 * 60 * 1000);
  const referenceLocal = getJerusalemParts(offsetReference);
  const referenceAsUtc = Date.UTC(
    referenceLocal.year,
    referenceLocal.month - 1,
    referenceLocal.day,
    referenceLocal.hour,
    referenceLocal.minute,
    referenceLocal.second,
  );
  const boundary = new Date(
    localBoundaryAsUtc - (referenceAsUtc - offsetReference.getTime()),
  );
  const actual = getJerusalemParts(boundary);

  // If timezone rules don't map this local boundary exactly, avoid caching it.
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== 1 ||
    actual.minute !== 5 ||
    actual.second !== 0
  ) {
    return instant;
  }

  return boundary;
}

export function publicCatalogCachePolicy(
  renderInstant: Date = new Date(),
  responseInstant: Date = renderInstant,
) {
  if (getCinemaDayDate(renderInstant) !== getCinemaDayDate(responseInstant))
    return { cacheControl: "no-store" };

  const secondsToBoundary = Math.floor(
    (getNextCinemaDayBoundary(renderInstant).getTime() -
      responseInstant.getTime()) /
      1000,
  );
  if (secondsToBoundary <= 1) return { cacheControl: "no-store" };

  const freshSeconds = Math.min(
    PUBLIC_CATALOG_CACHE_TTL_SECONDS,
    secondsToBoundary - 1,
  );
  const staleSeconds = Math.min(
    PUBLIC_CATALOG_STALE_SECONDS,
    secondsToBoundary - freshSeconds - 1,
  );

  return {
    cacheControl: `public, max-age=0, s-maxage=${freshSeconds}, stale-while-revalidate=${staleSeconds}`,
    cacheTag: PUBLIC_CATALOG_CACHE_TAG,
  };
}

function withDeadline<Value>(
  operation: () => Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Public page request exceeded its deadline.")),
      timeoutMs,
    );
  });
  return Promise.race([operation(), deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

let baseHtml: string | null = null;
function getBaseHtml(): string {
  if (baseHtml) return baseHtml;
  try {
    baseHtml = readFileSync(
      resolve(process.cwd(), "Codebase - Kartiseret Web/dist/index.html"),
      "utf8",
    );
  } catch {
    baseHtml =
      '<!doctype html><html lang="en" class="no-js"><head><meta charset="utf-8"><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><div id="seo-content"></div><!-- SEO_CONTENT_END --><div id="root"></div></body></html>';
  }
  return baseHtml;
}

function dayOffset(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function movieJsonLd(movie: Movie): Record<string, unknown> {
  const image = safeHttpUrl(movie.imageSrc);
  return {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    ...(image ? { image } : {}),
    ...(movie.genres.length ? { genre: movie.genres } : {}),
    url: `${SITE_ORIGIN}/${encodeURIComponent(movie.movieCode ?? "")}`,
  };
}

function normalizeShowtime(value: string): string {
  return value.trim().slice(0, 5);
}

function compareShowtimes(
  left: Pick<
    PublicShowtime,
    "dateOfShowing" | "showtime" | "screeningCity" | "cinema"
  >,
  right: Pick<
    PublicShowtime,
    "dateOfShowing" | "showtime" | "screeningCity" | "cinema"
  >,
): number {
  return (
    left.dateOfShowing.localeCompare(right.dateOfShowing) ||
    left.showtime.localeCompare(right.showtime) ||
    left.screeningCity.localeCompare(right.screeningCity) ||
    left.cinema.localeCompare(right.cinema)
  );
}

function bootstrapCatalog(
  catalog: Awaited<ReturnType<typeof getMovieCatalog>>,
  publicationRevision: string,
) {
  return { ...catalog, publicationRevision };
}

function createPageBootstrap(
  pathname: string,
  publicationRevision: string,
  instant: Date,
  catalogs: {
    nowPlaying?: Awaited<ReturnType<typeof getMovieCatalog>>;
    comingSoon?: Awaited<ReturnType<typeof getMovieCatalog>>;
  },
  extra: Partial<PublicPageBootstrap> = {},
): PublicPageBootstrap {
  return publicPageBootstrapSchema.parse({
    version: 1,
    pathname,
    renderedAt: instant.toISOString(),
    publicationRevision,
    catalogs: {
      nowPlaying:
        catalogs.nowPlaying &&
        bootstrapCatalog(catalogs.nowPlaying, publicationRevision),
      comingSoon:
        catalogs.comingSoon &&
        bootstrapCatalog(catalogs.comingSoon, publicationRevision),
    },
    ...extra,
  });
}

async function getMoviePage(
  routeCode: string,
  instant = new Date(),
  imageOrigin = SITE_ORIGIN,
  requestedDate?: string,
  preferredCity: AppLocation = DEFAULT_LOCATION,
) {
  const selection = resolvePreviewRouteSelection(
    routeCode,
    instant,
    requestedDate,
  );
  if (!selection) return null;
  const repository = getProductionPublicDataRepository();

  return withPublicationSnapshot(repository, async (publicationRevision) => {
    const result = await getMovieByPermanentCode(
      repository,
      selection.movieCode,
    );
    if (!result) return null;
    let movie = result.movie;
    const isComingSoon = result.isComingSoon;
    if (movie.movieCode) {
      try {
        const route = await new PostgresPublicRouteRegistry(
          getProductionDataRuntime().publicRoutePool,
        ).getOrCreate(moviePublicRouteInput(movie.movieCode));
        movie = { ...movie, publicRouteCode: route.code };
      } catch (error) {
        logErrorSafely(
          "movie_public_route_unavailable",
          error,
          "Could not assign an opaque movie link during page rendering.",
        );
      }
    }
    const parsedRoute = parseMovieRouteCode(routeCode);
    let rows: PublicShowtime[] = [];
    let allMovieShowtimes: PublicShowtime[] = [];
    if (!isComingSoon || parsedRoute?.kind === "encoded") {
      const fromDate = getCinemaDayDate(instant);
      allMovieShowtimes = await getMovieShowtimes(
        repository,
        movie.tmdbId,
        fromDate,
      );
      rows = [...allMovieShowtimes];
      if (parsedRoute?.kind === "encoded") {
        rows = rows.filter(
          (row) =>
            row.screeningCity === selection.city &&
            row.dateOfShowing === selection.date,
        );
        rows = filterShowtimeRows(rows, parsedRoute.filterMask);
      }
      rows = rows.filter((row) =>
        shouldIncludeShowtime(
          row.dateOfShowing,
          normalizeShowtime(row.showtime),
          instant,
        ));
      rows.sort(compareShowtimes);
    }
    const theaters = await getPublicTheaterData(repository);
    const posterUrl = safeHttpUrl(movie.imageSrc);
    const isEncodedSelection = parsedRoute?.kind === "encoded";
    const selectedShowtimes = rows
      .slice(0, 2)
      .map((row) => `${row.cinema} at ${row.showtime}`)
      .join(" · ");
    const description = isEncodedSelection
      ? `${movie.title} showtimes in ${selection.city} on ${selection.date}${selectedShowtimes ? `: ${selectedShowtimes}` : ". No showtimes are listed for this selection"}.`
      : `${movie.title}${movie.year ? ` (${movie.year})` : ""}. ${isComingSoon ? "Coming soon information" : "Find upcoming movie showtimes at cinemas across Israel"} on Kartiseret.`;
    const openGraphImageUrl =
      (movie.socialPreviewFingerprint
        ? socialPreviewImageUrl(imageOrigin, movie.socialPreviewFingerprint)
        : null) ?? posterUrl;
    const currentDate = getCinemaDayDate(instant);
    const selectedCity =
      parsedRoute?.kind === "encoded"
        ? (selection.city as typeof DEFAULT_LOCATION)
        : preferredCity;
    const selectedDate =
      parsedRoute?.kind === "encoded" ? selection.date : currentDate;
    const bootstrap = createPageBootstrap(
      parsedRoute?.kind === "encoded"
        ? `/${routeCode}?date=${encodeURIComponent(selection.date)}`
        : `/${routeCode}`,
      publicationRevision,
      instant,
      {},
      {
        theaters,
        movieDetail: {
          movie,
          mode: isComingSoon ? "comingSoon" : "nowPlaying",
        },
        ...(!isComingSoon || parsedRoute?.kind === "encoded"
          ? {
              targetedMovieShowtimes: {
                city: selectedCity,
                date: selectedDate,
                tmdbId: movie.tmdbId,
                showtimes: allMovieShowtimes.filter(
                  (row) =>
                    row.screeningCity === selectedCity &&
                    row.dateOfShowing === selectedDate,
                ),
              },
            }
          : {}),
      },
    );
    return {
      movie,
      isComingSoon,
      bootstrap,
      page: {
        title: `${movie.title}${isComingSoon ? " — Coming soon" : " showtimes in Israel"} | Kartiseret`,
        description,
        canonicalPath: `/${selection.movieCode}`,
        openGraphPath:
          parsedRoute?.kind === "encoded"
            ? `/${routeCode}?date=${encodeURIComponent(selection.date)}`
            : `/${routeCode}`,
        imageUrl: openGraphImageUrl,
        imageAlt: `${movie.title} movie preview`,
        jsonLd: movieJsonLd(movie),
      },
    };
  });
}

async function getCinemaPage(cinemaId: string, instant = new Date()) {
  const repository = getProductionPublicDataRepository();
  return withPublicationSnapshot(repository, async (publicationRevision) => {
    const identity = getCinemaIdentityById(cinemaId);
    if (!identity) return null;
    const contextPromise: Promise<PublicCinemaPageContext> = Promise.all([
      getPublicTheaterData(repository),
      getMovieCatalog(repository, "nowPlaying"),
      getMovieCatalog(repository, "comingSoon"),
    ]).then(([theaterCatalog, nowPlaying, comingSoon]) => ({
      theaterCatalog,
      nowPlaying,
      comingSoon,
    }));
    const [cinema, context] = await Promise.all([
      getCinemaPageData(repository, cinemaId, instant, contextPromise),
      contextPromise,
    ]);
    if (!cinema) return null;
    let { nowPlaying, comingSoon } = context;
    let cinemaWithMovieRoutes = cinema;
    try {
      const registry = new PostgresPublicRouteRegistry(
        getProductionDataRuntime().publicRoutePool,
      );
      const routedMovies = await attachMoviePublicRouteCodes(
        {
          movies: [
            ...nowPlaying.movies,
            ...comingSoon.movies,
            ...cinema.screenings.map(({ movie }) => movie),
          ],
        },
        registry,
      );
      const moviesById = new Map(
        routedMovies.movies.map((movie) => [movie.tmdbId, movie]),
      );
      const withRoutes = (catalog: typeof nowPlaying) => ({
        ...catalog,
        movies: catalog.movies.map(
          (movie) => moviesById.get(movie.tmdbId) ?? movie,
        ),
      });
      nowPlaying = withRoutes(nowPlaying);
      comingSoon = withRoutes(comingSoon);
      cinemaWithMovieRoutes = {
        ...cinema,
        screenings: cinema.screenings.map((screening) => ({
          ...screening,
          movie: moviesById.get(screening.movie.tmdbId) ?? screening.movie,
        })),
      };
    } catch (error) {
      logErrorSafely(
        "cinema_movie_routes_unavailable",
        error,
        "Could not attach opaque movie links to the cinema page.",
      );
    }
    const address = cinema.address.trim();
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "MovieTheater",
      name: cinema.displayName,
      ...(identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name))
        ? {
            alternateName: identity.cinemaNameKeys.find((name) =>
              /^Yes Planet\s/i.test(name)),
          }
        : {}),
      url: `${SITE_ORIGIN}/__cinema/${cinemaId}`,
      address: {
        "@type": "PostalAddress",
        ...(address ? { streetAddress: address } : {}),
        addressLocality: cinema.city,
        addressCountry: "IL",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: cinema.latitude,
        longitude: cinema.longitude,
      },
    };
    const bootstrap = createPageBootstrap(
      `/__cinema/${cinemaId}`,
      publicationRevision,
      instant,
      { nowPlaying, comingSoon },
      { cinema: cinemaWithMovieRoutes },
    );
    return {
      bootstrap,
      page: {
        title: `${cinema.displayName}${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name)) ? ` (${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name))})` : ""} showtimes in ${cinema.city} | Kartiseret`,
        description: `Browse upcoming movie showtimes at ${cinema.displayName}${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name)) ? `, also known as ${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name))}` : ""}, in ${cinema.city}.`,
        canonicalPath: `/__cinema/${cinemaId}`,
        jsonLd,
        noindex: cinemaWithMovieRoutes.screenings.length === 0,
      },
    };
  });
}

type ShowtimeEligibilityRepository = ReturnType<
  typeof getProductionPublicDataRepository
>;

async function getShowtimeEligibility(
  repository: ShowtimeEligibilityRepository,
  catalog: Awaited<ReturnType<typeof getMovieCatalog>>,
  instant: Date,
  cinemaCatalog?: Awaited<ReturnType<typeof getMovieCatalog>>,
) {
  if (catalog.movieCodesStatus !== "ready") {
    throw new Error("Movie code data is unavailable.");
  }
  const startDate = getCinemaDayDate(instant);
  const cityEndDate = dayOffset(startDate, 6);
  const supportedCities = new Set<string>(ALL_LOCATIONS);
  const screeningCities = cinemaCatalog
    ? [
        ...new Set([
          ...supportedCities,
          ...CINEMA_IDENTITIES.flatMap(({ city, screeningCityKeys }) =>
            screeningCityKeys.length ? screeningCityKeys : [city]),
        ]),
      ]
    : [...supportedCities];
  const candidates = await repository.findShowtimeEligibilityCandidates(
    screeningCities,
    startDate,
    dayOffset(startDate, 29),
  );
  const cityMovieIds = new Set(
    catalog.movies
      .filter((movie) => movie.movieCode)
      .map((movie) => movie.tmdbId),
  );
  const cinemaMovieIds = cinemaCatalog
    ? new Set(
        [...catalog.movies, ...cinemaCatalog.movies].map(
          (movie) => movie.tmdbId,
        ),
      )
    : null;
  const activeCities = new Set<string>();
  const activeCinemaIds = new Set<string>();
  let hasNationalShowtimes = false;
  const isUpcoming = createShowtimeInclusionPredicate(instant);
  for (const row of candidates) {
    const city = row.screeningCity?.trim();
    if (
      row.tmdbId === null ||
      !city ||
      !row.cinema?.trim() ||
      !row.dateOfShowing ||
      !row.showtime
    )
      continue;
    const movieId = String(row.tmdbId);
    const eligibleCity = supportedCities.has(city) && cityMovieIds.has(movieId);
    const eligibleCinema =
      cinemaMovieIds && (row.isCinematheque || cinemaMovieIds.has(movieId));
    if (
      (!eligibleCity && !eligibleCinema) ||
      !isUpcoming(row.dateOfShowing, row.showtime)
    )
      continue;
    if (eligibleCity) {
      hasNationalShowtimes = true;
      if (!cinemaCatalog) break;
      if (row.dateOfShowing <= cityEndDate) activeCities.add(city);
    }
    if (eligibleCinema) {
      const identity = findCinemaIdentityForScreening(city, row.cinema);
      const aliases = identity?.screeningCityKeys.length
        ? identity.screeningCityKeys
        : [identity?.city];
      if (
        identity &&
        aliases.some((name) => name?.toLowerCase() === city.toLowerCase())
      ) {
        activeCinemaIds.add(identity.id);
      }
    }
  }
  return { hasNationalShowtimes, activeCities, activeCinemaIds };
}

function hasIndexableCityShowtimes(
  rows: readonly PublicShowtime[],
  catalog: Awaited<ReturnType<typeof getMovieCatalog>>,
  instant: Date,
): boolean {
  const publicMovieIds = new Set(
    catalog.movies
      .filter((movie) => movie.movieCode)
      .map((movie) => movie.tmdbId),
  );
  return rows.some(
    (row) =>
      publicMovieIds.has(row.tmdbId) &&
      shouldIncludeShowtime(
        row.dateOfShowing,
        normalizeShowtime(row.showtime),
        instant,
      ),
  );
}

async function buildListingPage(
  repository: ReturnType<typeof getProductionPublicDataRepository>,
  path: string,
  catalogs?: {
    nowPlaying?: Awaited<ReturnType<typeof getMovieCatalog>>;
    comingSoon?: Awaited<ReturnType<typeof getMovieCatalog>>;
  },
  instant = new Date(),
  preferredCity: AppLocation = DEFAULT_LOCATION,
) {
  let title = "Kartiseret movie listings";
  let description =
    "Browse movie listings and showtimes across Israeli cinemas.";
  let jsonLd: unknown;
  let indexable = false;
  let cinemathequeData:
    Awaited<ReturnType<typeof getCinemathequeData>> | undefined;
  let showtimeRows: PublicShowtime[] = [];
  if (path === "/") {
    title = "Kartiseret — Movie showtimes across Israel";
    description = "Find movie showtimes across Israeli cinemas in one place.";
    indexable = true;
    jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Kartiseret", url: SITE_ORIGIN + "/" },
        {
          "@type": "Organization",
          name: "Kartiseret",
          url: SITE_ORIGIN + "/",
          logo: SITE_ORIGIN + "/logos/kartiseret1.svg",
        },
      ],
    };
  } else if (path === "/movies" || path === "/soons") {
    const mode = path === "/movies" ? "nowPlaying" : "comingSoon";
    const catalog =
      catalogs?.[mode] ?? (await getMovieCatalog(repository, mode));
    title =
      path === "/movies"
        ? "Movies showing in Israel | Kartiseret"
        : "Coming soon movies in Israel | Kartiseret";
    description =
      path === "/movies"
        ? "Browse movies showing at cinemas across Israel."
        : "Browse upcoming movie releases and details on Kartiseret.";
    indexable = catalog.movies.some((movie) => Boolean(movie.movieCode));
    jsonLd = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: catalog.movies
        .filter((movie) => movie.movieCode)
        .slice(0, 80)
        .map((movie, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${SITE_ORIGIN}/${encodeURIComponent(movie.movieCode!)}`,
          name: movie.title,
        })),
    };
  } else if (path === "/cinematheques") {
    const [data, nowPlaying, comingSoon] = await Promise.all([
      getCinemathequeData(repository, {
        city: DEFAULT_LOCATION,
        startDate: getCinemaDayDate(instant),
      }),
      catalogs?.nowPlaying ?? getMovieCatalog(repository, "nowPlaying"),
      catalogs?.comingSoon ?? getMovieCatalog(repository, "comingSoon"),
    ]);
    cinemathequeData =
      preferredCity === DEFAULT_LOCATION
        ? data
        : await getCinemathequeData(repository, {
            city: preferredCity,
            startDate: getCinemaDayDate(instant),
          });
    const publicMovies = new Map(
      [...nowPlaying.movies, ...comingSoon.movies]
        .filter((movie) => movie.movieCode)
        .map((movie) => [movie.tmdbId, movie]),
    );
    const movies = data.movies.flatMap((movie) => {
      const publicMovie = publicMovies.get(movie.tmdbId);
      return publicMovie ? [publicMovie] : [];
    });
    title = "Cinematheque movie showtimes | Kartiseret";
    description = "Browse upcoming cinematheque movie screenings in Israel.";
    indexable = movies.length > 0;
  } else if (path === "/showtimes") {
    const startDate = getCinemaDayDate(instant);
    const catalog =
      catalogs?.nowPlaying ?? (await getMovieCatalog(repository, "nowPlaying"));
    const [rows, eligibility] = await Promise.all([
      getShowtimeRange(repository, {
        city: preferredCity,
        startDate,
        endDate: dayOffset(startDate, 6),
      }),
      getShowtimeEligibility(repository, catalog, instant),
    ]);
    showtimeRows = rows;
    title = "Movie showtimes in Israel — Now Playing | Kartiseret";
    description =
      "Browse movies currently showing at cinemas across Israel, with showtimes and booking links.";
    indexable = eligibility.hasNationalShowtimes;
  } else {
    const city = getShowtimesCityFromPath(path);
    if (city) {
      const startDate = getCinemaDayDate(instant);
      const endDate = dayOffset(startDate, 6);
      const [rows, catalog] = await Promise.all([
        getShowtimeRange(repository, { city, startDate, endDate }),
        catalogs?.nowPlaying ?? getMovieCatalog(repository, "nowPlaying"),
      ]);
      if (catalog.movieCodesStatus !== "ready")
        throw new Error("Movie code data is unavailable.");
      showtimeRows = rows;
      title = `Movie showtimes in ${city} — Now Playing | Kartiseret`;
      description = `Browse movies currently showing in ${city}, with local cinema times and booking links.`;
      indexable = hasIndexableCityShowtimes(rows, catalog, instant);
    }
  }
  return {
    indexable,
    ...(cinemathequeData ? { cinemathequeData } : {}),
    ...(path === "/showtimes" || getShowtimesCityFromPath(path)
      ? { showtimeRows }
      : {}),
    page: {
      title,
      description,
      canonicalPath: path,
      jsonLd,
      noindex: !indexable,
    },
  };
}

async function getListingPage(
  path: string,
  instant = new Date(),
  preferredCity: AppLocation = DEFAULT_LOCATION,
) {
  const repository = getProductionPublicDataRepository();
  // Featured content is independent of the catalog snapshot. Read it before
  // the snapshot pins the connection in the serverless pool.
  const featuredData =
    path === "/"
      ? await Promise.resolve()
          .then(() =>
            new HomepageFeaturedService(
              getProductionDataRuntime().database.db,
            ).readPublic(instant))
          .catch((error: unknown) => {
            logErrorSafely(
              "homepage_featured_unavailable",
              error,
              "Homepage featured content could not be loaded.",
            );
            return undefined;
          })
      : undefined;
  return withPublicationSnapshot(repository, async (publicationRevision) => {
    const city = getShowtimesCityFromPath(path) ?? preferredCity;
    const [initialNowPlaying, initialComingSoon, theaters] = await Promise.all([
      path === "/soons" ? undefined : getMovieCatalog(repository, "nowPlaying"),
      path === "/movies"
        ? undefined
        : getMovieCatalog(repository, "comingSoon"),
      ["/", "/movies", "/soons"].includes(path)
        ? undefined
        : getPublicTheaterData(repository),
    ]);
    let nowPlaying = initialNowPlaying;
    let comingSoon = initialComingSoon;
    let publicRouteRegistry: PostgresPublicRouteRegistry | null = null;
    try {
      publicRouteRegistry = new PostgresPublicRouteRegistry(
        getProductionDataRuntime().publicRoutePool,
      );
      [nowPlaying, comingSoon] = await Promise.all([
        nowPlaying
          ? attachMoviePublicRouteCodes(nowPlaying, publicRouteRegistry)
          : undefined,
        comingSoon
          ? attachMoviePublicRouteCodes(comingSoon, publicRouteRegistry)
          : undefined,
      ]);
    } catch (error) {
      logErrorSafely(
        "catalog_public_routes_unavailable",
        error,
        "Could not assign opaque movie links during listing rendering.",
      );
    }
    const page = await buildListingPage(
      repository,
      path,
      { nowPlaying, comingSoon },
      instant,
      preferredCity,
    );
    if (page.cinemathequeData) {
      try {
        publicRouteRegistry ??= new PostgresPublicRouteRegistry(
          getProductionDataRuntime().publicRoutePool,
        );
        page.cinemathequeData = await attachMoviePublicRouteCodes(
          page.cinemathequeData,
          publicRouteRegistry,
        );
      } catch (error) {
        logErrorSafely(
          "cinematheque_movie_routes_unavailable",
          error,
          "Could not attach opaque movie links to the cinematheque page.",
        );
      }
    }
    const currentDate = getCinemaDayDate(instant);
    const extra: Partial<PublicPageBootstrap> = { theaters };
    if (featuredData) extra.homepageFeatured = featuredData;
    if (path === "/showtimes" || getShowtimesCityFromPath(path)) {
      extra.showtimeCity = {
        city,
        startDate: currentDate,
        endDate: dayOffset(currentDate, 6),
        showtimes: (page.showtimeRows ?? []).filter(
          (row) => row.dateOfShowing <= dayOffset(currentDate, 6),
        ),
      };
    }
    if (path === "/cinematheques" && page.cinemathequeData) {
      extra.cinematheques = {
        city: preferredCity,
        publicationRevision,
        data: page.cinemathequeData,
      };
    }
    const bootstrap = createPageBootstrap(
      path,
      publicationRevision,
      instant,
      { nowPlaying, comingSoon },
      extra,
    );
    return { ...page, bootstrap };
  });
}

async function renderSitemap(response: VercelResponse): Promise<void> {
  const renderInstant = new Date();
  try {
    const repository = getProductionPublicDataRepository();
    const paths = await withPublicationSnapshot(repository, async () => {
      const [nowPlaying, comingSoon, theaterData] = await Promise.all([
        getMovieCatalog(repository, "nowPlaying"),
        getMovieCatalog(repository, "comingSoon"),
        getPublicTheaterData(repository),
      ]);
      if (
        nowPlaying.movieCodesStatus !== "ready" ||
        comingSoon.movieCodesStatus !== "ready"
      ) {
        throw new Error("Movie code data is unavailable.");
      }
      const registry = new PostgresPublicRouteRegistry(
        getProductionDataRuntime().publicRoutePool,
      );
      const movieRoutes = [...nowPlaying.movies, ...comingSoon.movies]
        .filter((movie) => movie.movieCode)
        .map((movie) => ({
          destinationKey: `movie-code:${movie.movieCode}`,
          kind: "movie" as const,
          destinationId: movie.movieCode!,
        }));
      const [eligibility, cinemathequesListing] = await Promise.all([
        getShowtimeEligibility(
          repository,
          nowPlaying,
          renderInstant,
          comingSoon,
        ),
        buildListingPage(
          repository,
          "/cinematheques",
          { nowPlaying, comingSoon },
          renderInstant,
        ),
      ]);
      const eligibleCityPaths = ALL_LOCATIONS.filter((city) =>
        eligibility.activeCities.has(city)).map(getShowtimesCityPath);
      const theaterCinemaIds = new Set(
        theaterData.theaters.flatMap((theater) => {
          const cinemaId = cinemaIdForLocation(theater.location);
          return cinemaId ? [cinemaId] : [];
        }),
      );
      const cinemaRoutes = CINEMA_IDENTITIES.filter(
        ({ id }) =>
          theaterCinemaIds.has(id) && eligibility.activeCinemaIds.has(id),
      ).map(({ id }) => ({
        destinationKey: `cinema:${id}`,
        kind: "cinema" as const,
        destinationId: id,
      }));
      const listingPaths = [
        ...(nowPlaying.movies.some((movie) => movie.movieCode)
          ? ["/movies"]
          : []),
        ...(comingSoon.movies.some((movie) => movie.movieCode)
          ? ["/soons"]
          : []),
        ...(eligibility.hasNationalShowtimes ? ["/showtimes"] : []),
        ...(cinemathequesListing.indexable ? ["/cinematheques"] : []),
      ];
      const routeInputs = [
        { destinationKey: "page:/", kind: "page" as const, destinationId: "/" },
        ...listingPaths.map((path) => ({
          destinationKey: `page:${path}`,
          kind: "page" as const,
          destinationId: path,
        })),
        ...eligibleCityPaths.flatMap((path) => {
          const city = getShowtimesCityFromPath(path);
          return city
            ? [
                {
                  destinationKey: `city:${city}`,
                  kind: "city" as const,
                  destinationId: city,
                },
              ]
            : [];
        }),
        ...movieRoutes,
        ...cinemaRoutes,
      ];
      const routes = await registry.getOrCreateMany(routeInputs);
      return routes.map((route) => `/${route.code}`);
    });
    const xml = buildSitemapXml(paths);
    const cachePolicy = publicCatalogCachePolicy(renderInstant, new Date());
    response
      .status(200)
      .setHeader("Content-Type", "application/xml; charset=utf-8")
      .setHeader("Cache-Control", cachePolicy.cacheControl);
    if (cachePolicy.cacheTag)
      response.setHeader("Vercel-Cache-Tag", cachePolicy.cacheTag);
    response.send(xml);
  } catch (error) {
    logErrorSafely(
      "public_sitemap_build_failed",
      error,
      "Could not build public sitemap.",
    );
    response
      .status(503)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send("Sitemap temporarily unavailable.");
  }
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  const dispatchRoute =
    request.url?.split("?", 1)[0]?.replace(/^\/api\//, "") ?? "";
  const privateRoute = [
    "private-page",
    "private-cinema",
    "private-movie",
    "private-legacy-movie",
    "private-route-code",
  ].includes(dispatchRoute);
  let route = privateRoute
    ? dispatchRoute.slice("private-".length)
    : dispatchRoute;
  let resolvedRoute: { route: PublicRoute; renderPath: string } | undefined;
  if (privateRoute) {
    response
      .setHeader("Cache-Control", PRIVATE_PAGE_CACHE)
      .setHeader("Vary", "Cookie");
  }
  if (route === "robots") {
    const isPreview = Boolean(
      process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production",
    );
    response
      .status(200)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Cache-Control", "public, max-age=300")
      .send(
        isPreview
          ? "User-agent: *\nDisallow: /\n"
          : "User-agent: *\nAllow: /\nSitemap: https://seret.site/sitemap.xml\n",
      );
    return;
  }
  if (route === "sitemap") return renderSitemap(response);
  // The homepage's Vercel routes can bypass the configured headers.
  response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  const html = getBaseHtml();
  try {
    if (route === "email-action") {
      const code = Array.isArray(request.query.code)
        ? (request.query.code.at(-1) ?? "")
        : (request.query.code ?? "");
      const isValidAction = isSecureEmailActionPath(`/${code}`);
      if (!isValidAction) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .setHeader("Cache-Control", "no-store")
          .send("This email link is invalid or expired.");
        return;
      }
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("Cache-Control", "private, no-store")
        .setHeader("Referrer-Policy", "no-referrer")
        .setHeader("X-Robots-Tag", "noindex, nofollow, noarchive")
        .send(html);
      return;
    }

    if (route === "page" && !resolvedRoute) {
      const legacyPath = Array.isArray(request.query.path)
        ? (request.query.path.at(-1) ?? "")
        : (request.query.path ?? "");
      const publicPagePath = getPublicPageRequestPath(
        legacyPath,
        request.query,
      );
      const input = resolveLegacyPublicRoute(publicPagePath);
      if (input) {
        const runtime = getProductionDataRuntime();
        if (input.kind === "movie" || input.kind === "share") {
          const movie = await getMovieByPermanentCode(
            getProductionPublicDataRepository(),
            input.destinationId,
          );
          if (!movie) {
            response
              .status(404)
              .setHeader("Content-Type", "text/plain; charset=utf-8")
              .setHeader("X-Robots-Tag", "noindex, nofollow")
              .setHeader("Cache-Control", "no-store")
              .send("Page not found.");
            return;
          }
        }
        const routeRecord = await new PostgresPublicRouteRegistry(
          runtime.publicRoutePool,
        ).getOrCreate(input);
        response
          .status(308)
          .setHeader("Cache-Control", "public, max-age=300")
          .setHeader("Location", `/${routeRecord.code}`)
          .send("");
        return;
      }
    }

    if (route === "movie" || route === "legacy-movie") {
      const legacyCode = Array.isArray(request.query.routeCode)
        ? (request.query.routeCode.at(-1) ?? "")
        : (request.query.routeCode ?? "");
      const search = new URLSearchParams();
      for (const name of ["date", "excludeCinemas"] as const) {
        const value = request.query[name];
        const selected = Array.isArray(value) ? value.at(-1) : value;
        if (selected) search.set(name, selected);
      }
      const legacyPath = `/${legacyCode}${search.size ? `?${search}` : ""}`;
      const input = resolveLegacyPublicRoute(legacyPath);
      if (!input || (input.kind !== "movie" && input.kind !== "share")) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .setHeader("Cache-Control", "no-store")
          .send("Page not found.");
        return;
      }
      const movie = await getMovieByPermanentCode(
        getProductionPublicDataRepository(),
        input.destinationId,
      );
      if (!movie) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .setHeader("Cache-Control", "no-store")
          .send("Page not found.");
        return;
      }
      const runtime = getProductionDataRuntime();
      const routeRecord = await new PostgresPublicRouteRegistry(
        runtime.publicRoutePool,
      ).getOrCreate(input);
      response
        .status(308)
        .setHeader("Cache-Control", "public, max-age=300")
        .setHeader("Location", `/${routeRecord.code}`)
        .send("");
      return;
    }

    if (route === "route-code") {
      const code = Array.isArray(request.query.code)
        ? (request.query.code.at(-1) ?? "")
        : (request.query.code ?? "");
      const runtime = getProductionDataRuntime();
      const storedRoute = await new PostgresPublicRouteRegistry(
        runtime.publicRoutePool,
      ).getByCode(code);
      const renderPath = storedRoute
        ? getPublicRouteRenderPath(storedRoute)
        : null;
      if (!storedRoute || !renderPath) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .setHeader("Cache-Control", "no-store")
          .send("Page not found.");
        return;
      }
      resolvedRoute = { route: storedRoute, renderPath };
      if (storedRoute.kind === "page" || storedRoute.kind === "city") {
        route = "page";
        request.query.path = renderPath;
      } else if (storedRoute.kind === "cinema") {
        route = "cinema";
        request.query.cinemaId = storedRoute.destinationId;
      } else {
        route = "movie";
        const shareUrl = new URL(renderPath, SITE_ORIGIN);
        request.query.routeCode = decodeURIComponent(
          shareUrl.pathname.slice(1),
        );
        request.query.date = shareUrl.searchParams.get("date") ?? "";
        request.query.excludeCinemas =
          shareUrl.searchParams.get("excludeCinemas") ?? "";
      }
    }
    const cinemaId = Array.isArray(request.query.cinemaId)
      ? (request.query.cinemaId.at(-1) ?? "")
      : (request.query.cinemaId ?? "");
    const path = Array.isArray(request.query.path)
      ? (request.query.path.at(-1) ?? "")
      : (request.query.path ?? "");
    const normalizedPagePath = path.split("?", 1)[0] ?? "";
    if (
      route === "page" &&
      resolvedRoute &&
      normalizedPagePath === "/third-party-licenses.txt"
    ) {
      try {
        const licenses = readFileSync(
          resolve(
            process.cwd(),
            "Codebase - Kartiseret Web/dist/third-party-licenses.txt",
          ),
          "utf8",
        );
        response
          .status(200)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("Cache-Control", "public, max-age=300")
          .setHeader("X-Robots-Tag", "noindex, nofollow")
          .send(licenses);
      } catch (error) {
        logErrorSafely(
          "third_party_licenses_unavailable",
          error,
          "Could not read the generated third-party license notices.",
        );
        response
          .status(503)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("Cache-Control", "no-store")
          .send("License notices are temporarily unavailable.");
      }
      return;
    }
    if (
      route === "page" &&
      resolvedRoute &&
      CLIENT_ONLY_PUBLIC_PATHS.has(normalizedPagePath)
    ) {
      response
        .status(200)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader(
          "Cache-Control",
          privateRoute && normalizedPagePath === "/user"
            ? PRIVATE_PAGE_CACHE
            : "public, max-age=60, s-maxage=300",
        )
        .setHeader("X-Robots-Tag", "noindex, nofollow")
        .send(html);
      return;
    }
    if (route === "cinema" && !/^[A-Za-z0-9_-]{12}$/.test(cinemaId)) {
      response
        .status(404)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .setHeader("X-Robots-Tag", "noindex")
        .setHeader("Cache-Control", "no-store")
        .send("Cinema not found.");
      return;
    }
    if (
      route === "page" &&
      !["/", "/movies", "/soons", "/showtimes", "/cinematheques"].includes(
        normalizedPagePath,
      ) &&
      !getShowtimesCityFromPath(normalizedPagePath)
    ) {
      response
        .status(404)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .setHeader("X-Robots-Tag", "noindex")
        .setHeader("Cache-Control", "no-store")
        .send("Page not found.");
      return;
    }

    const deadlineAt = Date.now() + PUBLIC_PAGE_DEADLINE_MS;
    const privateDeadline = Date.now() + PRIVATE_DISPLAY_BUDGET_MS;
    const renderInstant = new Date();
    const cookie = request.headers.cookie;
    const identity =
      privateRoute && typeof cookie === "string"
        ? withDeadline(
            () => readPrivateDisplay(cookie),
            PRIVATE_DISPLAY_BUDGET_MS,
          ).catch(() => null)
        : Promise.resolve(null);
    const rendered = await withDeadline(async () => {
      const result = await timeCatalogStage("public_data", async () => {
        let pageResult: {
          page: Parameters<typeof injectSeoPage>[1];
          bootstrap: PublicPageBootstrap;
        } | null = null;
        if (route === "movie") {
          const routeCode = Array.isArray(request.query.routeCode)
            ? (request.query.routeCode.at(-1) ?? "")
            : (request.query.routeCode ?? "");
          const requestedDate = Array.isArray(request.query.date)
            ? (request.query.date.at(-1) ?? "")
            : (request.query.date ?? "");
          const movie = await getMoviePage(
            routeCode,
            renderInstant,
            getRequestOrigin(request.headers),
            requestedDate,
            parseMovieRouteCode(routeCode)?.kind === "plain"
              ? (await identity)?.preferences.location
              : undefined,
          );
          pageResult = movie
            ? { page: movie.page, bootstrap: movie.bootstrap }
            : null;
        } else if (route === "cinema") {
          pageResult = await getCinemaPage(cinemaId, renderInstant);
        } else if (route === "page") {
          pageResult = await getListingPage(
            normalizedPagePath,
            renderInstant,
            normalizedPagePath === "/showtimes" ||
              normalizedPagePath === "/cinematheques"
              ? (await identity)?.preferences.location
              : undefined,
          );
        }
        return pageResult;
      });
      if (!result) return { result: null, output: "" };
      const account = await identity;
      let display: PrivatePageDisplay | undefined;
      if (account) {
        const budget = privateDeadline - Date.now();
        const movieTreatments =
          budget > 0
            ? await withDeadline(
                () =>
                  timeCatalogStage("page_movie_treatments", () =>
                    account.readMovieTreatments(
                      getPageMovieIds(result.bootstrap),
                    )),
                budget,
              ).catch(() => null)
            : null;
        display = privatePageDisplaySchema.parse({
          version: 1,
          accountKey: createHash("sha256").update(account.userId).digest("hex"),
          preferences: account.preferences,
          movieTreatments,
        });
      }
      let publicRoutePaths: Record<string, string> = {};
      const routeAllocationBudget = deadlineAt - Date.now();
      if (routeAllocationBudget <= 0) {
        throw new Error("Public page request exceeded its deadline.");
      }
      try {
        publicRoutePaths = await withDeadline(
          () =>
            createPublicRoutePathMap(
              new PostgresPublicRouteRegistry(
                getProductionDataRuntime().publicRoutePool,
              ),
            ),
          routeAllocationBudget,
        );
      } catch (error) {
        logErrorSafely(
          "public_route_link_map_unavailable",
          error,
          "Could not prepare opaque links for the rendered page.",
        );
      }
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Public page request exceeded its deadline.");
      }
      const bootstrappedRoute = resolvedRoute
        ? {
            ...result.bootstrap,
            publicRoutePaths,
            pathname: `/${resolvedRoute.route.code}`,
            resolvedRoute,
          }
        : { ...result.bootstrap, publicRoutePaths };
      if (resolvedRoute) {
        result.page.canonicalPath = `/${resolvedRoute.route.code}`;
        result.page.openGraphPath = `/${resolvedRoute.route.code}`;
        if (result.page.jsonLd) {
          result.page.jsonLd = {
            ...result.page.jsonLd,
            url: `${SITE_ORIGIN}/${resolvedRoute.route.code}`,
          };
        }
      }
      const metadataHtml = injectSeoPage(html, result.page);
      const markup = await timeCatalogStage("html_render", () =>
        renderBuiltPublicApplication(
          bootstrappedRoute,
          Math.min(SSR_RENDER_BUDGET_MS, remainingMs),
          display,
        ));
      const output = timeCatalogStageSync("html_assembly", () =>
        injectRenderedApplication(
          metadataHtml,
          markup,
          bootstrappedRoute,
          [],
          display,
        ));
      return { result, output };
    }, PUBLIC_PAGE_DEADLINE_MS);

    if (!rendered.result) {
      response
        .status(404)
        .setHeader("Content-Type", "text/html; charset=utf-8")
        .setHeader("X-Robots-Tag", "noindex, nofollow")
        .setHeader("Cache-Control", "no-store")
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Page not found | Kartiseret</title></head><body><main><h1>Page not found</h1><p>This movie or cinema page is not available.</p></main></body></html>',
        );
      return;
    }
    const { result, output } = rendered;
    const cachePolicy = privateRoute
      ? { cacheControl: PRIVATE_PAGE_CACHE }
      : resolvedRoute?.route.kind === "share"
        ? { cacheControl: "no-store" }
        : publicCatalogCachePolicy(renderInstant, new Date());
    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", cachePolicy.cacheControl);
    if (cachePolicy.cacheTag)
      response.setHeader("Vercel-Cache-Tag", cachePolicy.cacheTag);
    response
      .setHeader(
        "X-Robots-Tag",
        process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
          ? "noindex, nofollow"
          : result.page.noindex
            ? "noindex, nofollow"
            : "index, follow",
      )
      .send(output);
  } catch (error) {
    logErrorSafely(
      "public_seo_render_failed",
      error,
      "Could not render public SEO page.",
    );
    response
      .status(503)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send("Public page temporarily unavailable.");
  }
}
