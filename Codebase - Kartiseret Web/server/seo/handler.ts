import { getMovieCatalog, getCinemathequeData, getCinemaPageData, getMovieByPermanentCode, getMovieShowtimes, getPublicTheaterData, getShowtimeRange, withPublicationSnapshot, type PublicCinemaPageContext } from "@kartiseret/server/public-data";
import { privatePageDisplaySchema, publicPageBootstrapSchema, type PrivatePageDisplay, type PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { injectRenderedApplication, injectSeoPage, SITE_ORIGIN, buildSitemapXml, safeHttpUrl, getRequestOrigin } from "./renderHtml.js";
import { createShowtimeInclusionPredicate, getCinemaDayDate, shouldIncludeShowtime } from "@kartiseret/contracts/showtime-day";
import { cinemaIdForLocation, findCinemaIdentityForScreening, getCinemaIdentityById } from "./identities.js";
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
import { ALL_LOCATIONS } from "@kartiseret/contracts/preferences";
import { renderBuiltPublicApplication } from "./renderer.js";
import { logErrorSafely } from "@kartiseret/server/logging";
import type { Movie } from "@kartiseret/contracts/movies";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEO_CACHE = "public, max-age=0, s-maxage=60";
const HOME_PAGE_CACHE = `${SEO_CACHE}, stale-while-revalidate=300`;
const PRIVATE_PAGE_CACHE = "private, no-store";
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
const SITEMAP_CACHE = "public, max-age=0, s-maxage=300";
const PUBLIC_PAGE_DEADLINE_MS = 25_000;
const SSR_RENDER_BUDGET_MS = 12_000;

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
    const { movie, isComingSoon } = result;
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
    const { nowPlaying, comingSoon } = context;
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
      url: SITE_ORIGIN + "/c/" + cinemaId,
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
      "/c/" + cinemaId,
      publicationRevision,
      instant,
      { nowPlaying, comingSoon },
      { cinema },
    );
    return {
      bootstrap,
      page: {
        title: `${cinema.displayName}${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name)) ? ` (${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name))})` : ""} showtimes in ${cinema.city} | Kartiseret`,
        description: `Browse upcoming movie showtimes at ${cinema.displayName}${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name)) ? `, also known as ${identity.cinemaNameKeys.find((name) => /^Yes Planet\s/i.test(name))}` : ""}, in ${cinema.city}.`,
        canonicalPath: "/c/" + cinemaId,
        jsonLd,
        noindex: cinema.screenings.length === 0,
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
    const [nowPlaying, comingSoon, theaters] = await Promise.all([
      path === "/soons" ? undefined : getMovieCatalog(repository, "nowPlaying"),
      path === "/movies"
        ? undefined
        : getMovieCatalog(repository, "comingSoon"),
      ["/", "/movies", "/soons"].includes(path)
        ? undefined
        : getPublicTheaterData(repository),
    ]);
    const page = await buildListingPage(
      repository,
      path,
      { nowPlaying, comingSoon },
      instant,
      preferredCity,
    );
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
  try {
    const repository = getProductionPublicDataRepository();
    const paths = await withPublicationSnapshot(repository, async () => {
      const instant = new Date();
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
      const moviePaths = [...nowPlaying.movies, ...comingSoon.movies]
        .filter((movie) => movie.movieCode)
        .map((movie) => `/${movie.movieCode}`);
      const [eligibility, cinemathequesListing] = await Promise.all([
        getShowtimeEligibility(repository, nowPlaying, instant, comingSoon),
        buildListingPage(
          repository,
          "/cinematheques",
          { nowPlaying, comingSoon },
          instant,
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
      const cinemaPaths = CINEMA_IDENTITIES.filter(
        ({ id }) =>
          theaterCinemaIds.has(id) && eligibility.activeCinemaIds.has(id),
      ).map(({ id }) => `/c/${id}`);
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
      return [
        "/",
        ...listingPaths,
        ...eligibleCityPaths,
        ...moviePaths,
        ...cinemaPaths,
      ];
    });
    const xml = buildSitemapXml(paths);
    response
      .status(200)
      .setHeader("Content-Type", "application/xml; charset=utf-8")
      .setHeader("Cache-Control", SITEMAP_CACHE)
      .send(xml);
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
  const requestedPrivateRoute = [
    "private-page",
    "private-cinema",
    "private-movie",
  ].includes(dispatchRoute);
  const route = requestedPrivateRoute
    ? dispatchRoute.slice("private-".length)
    : dispatchRoute;
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
    const cinemaId = Array.isArray(request.query.cinemaId)
      ? (request.query.cinemaId.at(-1) ?? "")
      : (request.query.cinemaId ?? "");
    const path = Array.isArray(request.query.path)
      ? (request.query.path.at(-1) ?? "")
      : (request.query.path ?? "");
    const isHomePage = route === "page" && path === "/";
    const privateRoute = requestedPrivateRoute && !isHomePage;
    if (privateRoute) {
      response
        .setHeader("Cache-Control", PRIVATE_PAGE_CACHE)
        .setHeader("Vary", "Cookie");
    }
    const pageCache = isHomePage
      ? HOME_PAGE_CACHE
      : privateRoute
        ? PRIVATE_PAGE_CACHE
        : SEO_CACHE;
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
        path,
      ) &&
      !getShowtimesCityFromPath(path)
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
            new Date(),
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
          pageResult = await getCinemaPage(cinemaId);
        } else if (route === "page") {
          pageResult = await getListingPage(
            path,
            undefined,
            path === "/showtimes" || path === "/cinematheques"
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
      const metadataHtml = injectSeoPage(html, result.page);
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Public page request exceeded its deadline.");
      }
      const markup = await timeCatalogStage("html_render", () =>
        renderBuiltPublicApplication(
          result.bootstrap,
          Math.min(SSR_RENDER_BUDGET_MS, remainingMs),
          display,
        ));
      const output = timeCatalogStageSync("html_assembly", () =>
        injectRenderedApplication(
          metadataHtml,
          markup,
          result.bootstrap,
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
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Page not found | Kartiseret</title></head><body><main><h1>Page not found</h1><p>This movie or cinema page is not available.</p><a href="/">Return to Kartiseret</a></main></body></html>',
        );
      return;
    }
    const { result, output } = rendered;
    response
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", pageCache)
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
