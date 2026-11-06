import { getMovieCatalog, getCinemathequeData, getCinemaPageData, getMovieByPermanentCode, getMovieShowtimes, getPublicTheaterData, getShowtimeRange, withPublicationSnapshot, type PublicCinemaPageContext } from "@kartiseret/server/public-data";
import { injectRenderedApplication, injectSeoPage, SITE_ORIGIN, buildSitemapXml, safeHttpUrl, getRequestOrigin } from "./renderHtml.js";
import { publicPageBootstrapSchema, type PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { getCinemaDayDate, shouldIncludeShowtime } from "@kartiseret/contracts/showtime-day";
import { filterShowtimeRows, resolvePreviewRouteSelection } from "../og/previewData.js";
import { getProductionPublicDataRepository } from "@kartiseret/server/production";
import { socialPreviewImageUrl } from "@kartiseret/contracts/social-preview";
import { cinemaIdForLocation, getCinemaIdentityById } from "./identities.js";
import { parseMovieRouteCode } from "@kartiseret/contracts/showtime-links";
import type { VercelRequest, VercelResponse } from "../og/vercelTypes.js";
import type { PublicShowtime } from "@kartiseret/contracts/public-data";
import { DEFAULT_LOCATION } from "@kartiseret/contracts/preferences";
import { renderBuiltPublicApplication } from "./renderer.js";
import type { Movie } from "@kartiseret/contracts/movies";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEO_CACHE = "public, max-age=0, s-maxage=60";
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
    nowPlaying: Awaited<ReturnType<typeof getMovieCatalog>>;
    comingSoon: Awaited<ReturnType<typeof getMovieCatalog>>;
  },
  extra: Partial<PublicPageBootstrap> = {},
): PublicPageBootstrap {
  return publicPageBootstrapSchema.parse({
    version: 1,
    pathname,
    renderedAt: instant.toISOString(),
    publicationRevision,
    catalogs: {
      nowPlaying: bootstrapCatalog(catalogs.nowPlaying, publicationRevision),
      comingSoon: bootstrapCatalog(catalogs.comingSoon, publicationRevision),
    },
    ...extra,
  });
}

function getInitialPosterPreloadUrls(bootstrap: PublicPageBootstrap): string[] {
  if (bootstrap.pathname !== "/") return [];
  const movies = bootstrap.catalogs.nowPlaying.movies;
  return [movies.at(-1), ...movies.slice(0, 4)].flatMap((movie) =>
    movie?.imageSrc ? [movie.imageSrc] : []);
}

async function getMoviePage(
  routeCode: string,
  instant = new Date(),
  imageOrigin = SITE_ORIGIN,
  requestedDate?: string,
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
    const [theaters, nowPlayingCatalog, comingSoonCatalog] = await Promise.all([
      getPublicTheaterData(repository),
      getMovieCatalog(repository, "nowPlaying"),
      getMovieCatalog(repository, "comingSoon"),
    ]);
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
        : DEFAULT_LOCATION;
    const selectedDate =
      parsedRoute?.kind === "encoded" ? selection.date : currentDate;
    const bootstrap = createPageBootstrap(
      parsedRoute?.kind === "encoded"
        ? `/${routeCode}?date=${encodeURIComponent(selection.date)}`
        : `/${routeCode}`,
      publicationRevision,
      instant,
      { nowPlaying: nowPlayingCatalog, comingSoon: comingSoonCatalog },
      {
        theaters,
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
        title:
          cinema.displayName +
          (address ? ", " + address : "") +
          " showtimes in " +
          cinema.city +
          " | Kartiseret",
        description:
          "Upcoming movie listings at " +
          cinema.displayName +
          " in " +
          cinema.city +
          ".",
        canonicalPath: "/c/" + cinemaId,
        jsonLd,
      },
    };
  });
}

async function buildListingPage(
  repository: ReturnType<typeof getProductionPublicDataRepository>,
  path: string,
  catalogs?: {
    nowPlaying: Awaited<ReturnType<typeof getMovieCatalog>>;
    comingSoon: Awaited<ReturnType<typeof getMovieCatalog>>;
  },
  instant = new Date(),
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
    cinemathequeData = data;
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
    const endDate = dayOffset(startDate, 6);
    const [rows, catalog] = await Promise.all([
      getShowtimeRange(repository, {
        city: DEFAULT_LOCATION,
        startDate,
        endDate,
      }),
      catalogs?.nowPlaying ?? getMovieCatalog(repository, "nowPlaying"),
    ]);
    showtimeRows = rows;
    const movies = new Map(
      catalog.movies.map((movie) => [movie.tmdbId, movie]),
    );
    const grouped = new Map<string, { movie: Movie; rows: PublicShowtime[] }>();
    for (const row of rows.filter((entry) =>
      shouldIncludeShowtime(
        entry.dateOfShowing,
        normalizeShowtime(entry.showtime),
      ))) {
      const movie = movies.get(row.tmdbId);
      if (!movie?.movieCode) continue;
      const entry = grouped.get(movie.tmdbId) ?? { movie, rows: [] };
      entry.rows.push(row);
      grouped.set(movie.tmdbId, entry);
    }
    title = `Movie showtimes in ${DEFAULT_LOCATION} | Kartiseret`;
    description = `Browse upcoming movie showtimes in ${DEFAULT_LOCATION}.`;
    indexable = grouped.size > 0;
  }
  return {
    indexable,
    ...(cinemathequeData ? { cinemathequeData } : {}),
    ...(path === "/showtimes" ? { showtimeRows } : {}),
    page: {
      title,
      description,
      canonicalPath: path,
      jsonLd,
      noindex: !indexable,
    },
  };
}

async function getListingPage(path: string, instant = new Date()) {
  const repository = getProductionPublicDataRepository();
  return withPublicationSnapshot(repository, async (publicationRevision) => {
    const [nowPlaying, comingSoon, theaters] = await Promise.all([
      getMovieCatalog(repository, "nowPlaying"),
      getMovieCatalog(repository, "comingSoon"),
      getPublicTheaterData(repository),
    ]);
    const page = await buildListingPage(
      repository,
      path,
      { nowPlaying, comingSoon },
      instant,
    );
    const currentDate = getCinemaDayDate(instant);
    const extra: Partial<PublicPageBootstrap> = { theaters };
    if (path === "/showtimes") {
      extra.showtimeCity = {
        city: DEFAULT_LOCATION,
        startDate: currentDate,
        endDate: dayOffset(currentDate, 6),
        showtimes: page.showtimeRows ?? [],
      };
    }
    if (path === "/cinematheques" && page.cinemathequeData) {
      extra.cinematheques = {
        city: DEFAULT_LOCATION,
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
      const [
        nowPlaying,
        comingSoon,
        theaterData,
        showtimesListing,
        cinemathequesListing,
      ] = await Promise.all([
        getMovieCatalog(repository, "nowPlaying"),
        getMovieCatalog(repository, "comingSoon"),
        getPublicTheaterData(repository),
        buildListingPage(repository, "/showtimes"),
        buildListingPage(repository, "/cinematheques"),
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
      const cinemaPaths = theaterData.theaters
        .filter(
          (theater) =>
            theater.location.trim() &&
            theater.theaterName.trim() &&
            theater.city.name.trim(),
        )
        .flatMap((theater) => {
          const cinemaId = cinemaIdForLocation(theater.location);
          return cinemaId ? [`/c/${cinemaId}`] : [];
        });
      const listingPaths = [
        ...(nowPlaying.movies.some((movie) => movie.movieCode)
          ? ["/movies"]
          : []),
        ...(comingSoon.movies.some((movie) => movie.movieCode)
          ? ["/soons"]
          : []),
        ...(showtimesListing.indexable ? ["/showtimes"] : []),
        ...(cinemathequesListing.indexable ? ["/cinematheques"] : []),
      ];
      return ["/", ...listingPaths, ...moviePaths, ...cinemaPaths];
    });
    const xml = buildSitemapXml(paths);
    response
      .status(200)
      .setHeader("Content-Type", "application/xml; charset=utf-8")
      .setHeader("Cache-Control", SITEMAP_CACHE)
      .send(xml);
  } catch (error) {
    console.error("Could not build public sitemap.", {
      name: error instanceof Error ? error.name : "Error",
    });
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
  const route = request.url?.split("?", 1)[0]?.replace(/^\/api\//, "") ?? "";
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
  const html = getBaseHtml();
  try {
    const cinemaId = Array.isArray(request.query.cinemaId)
      ? (request.query.cinemaId.at(-1) ?? "")
      : (request.query.cinemaId ?? "");
    const path = Array.isArray(request.query.path)
      ? (request.query.path.at(-1) ?? "")
      : (request.query.path ?? "");
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
      !["/", "/movies", "/soons", "/showtimes", "/cinematheques"].includes(path)
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
    const rendered = await withDeadline(async () => {
      let result: {
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
        );
        result = movie
          ? { page: movie.page, bootstrap: movie.bootstrap }
          : null;
      } else if (route === "cinema") {
        result = await getCinemaPage(cinemaId);
      } else if (route === "page") {
        result = await getListingPage(path);
      }
      if (!result) return { result: null, output: "" };
      const metadataHtml = injectSeoPage(html, result.page);
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Public page request exceeded its deadline.");
      }
      const markup = await renderBuiltPublicApplication(
        result.bootstrap,
        Math.min(SSR_RENDER_BUDGET_MS, remainingMs),
      );
      const output = injectRenderedApplication(
        metadataHtml,
        markup,
        result.bootstrap,
        getInitialPosterPreloadUrls(result.bootstrap),
      );
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
      .setHeader("Cache-Control", SEO_CACHE)
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
    console.error("Could not render public SEO page.", {
      name: error instanceof Error ? error.name : "Error",
    });
    response
      .status(503)
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Cache-Control", "no-store")
      .send("Public page temporarily unavailable.");
  }
}
