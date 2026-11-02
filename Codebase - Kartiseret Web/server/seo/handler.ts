import { getMovieCatalog, getCinemathequeData, getMovieByPermanentCode, getPublicTheaterData, getShowtimeRange, getTicketAvailabilityShowtimes, withPublicationSnapshot } from "@kartiseret/server/public-data";
import { cinemaIdForLocation, findCinemaIdentityForScreening, findTheaterByCinemaId, getCinemaIdentityById } from "./identities.js";
import { escapeHtml, injectSeoPage, SITE_ORIGIN, buildSitemapXml, safeHttpUrl } from "./renderHtml.js";
import type { PublicShowtime, TicketAvailabilityShowtime } from "@kartiseret/contracts/public-data";
import { getCinemaDayDate, shouldIncludeShowtime } from "@kartiseret/contracts/showtime-day";
import { filterShowtimeRows, resolvePreviewRouteSelection } from "../og/previewData.js";
import { getProductionPublicDataRepository } from "@kartiseret/server/production";
import { parseMovieRouteCode } from "@kartiseret/contracts/showtime-links";
import type { VercelRequest, VercelResponse } from "../og/vercelTypes.js";
import { DEFAULT_LOCATION } from "@kartiseret/contracts/preferences";
import type { Movie } from "@kartiseret/contracts/movies";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_SCREENINGS_PER_PAGE = 50;
const SEO_CACHE = "public, max-age=0, s-maxage=60";
const SITEMAP_CACHE = "public, max-age=0, s-maxage=300";

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
      '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="seo-content"></div><div id="root"></div></body></html>';
  }
  return baseHtml;
}

function dayOffset(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function escapePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function movieLink(movie: Movie): string {
  return movie.movieCode ? `/${escapePathSegment(movie.movieCode)}` : "";
}

function bookingLink(value: string | null): string {
  const url = safeHttpUrl(value ?? undefined);
  return url
    ? ` · <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Booking information</a>`
    : "";
}

function movieListHtml(movies: readonly Movie[], limit = 80): string {
  const entries = movies
    .filter((movie) => movie.movieCode)
    .slice(0, limit)
    .map(
      (movie) =>
        `<li><a href="${escapeHtml(movieLink(movie))}">${escapeHtml(movie.title)}</a>${movie.year ? ` <span>(${movie.year})</span>` : ""}</li>`,
    )
    .join("");
  return entries
    ? `<ul>${entries}</ul>`
    : "<p>Movie listings are temporarily unavailable.</p>";
}

function movieJsonLd(movie: Movie): Record<string, unknown> {
  const image = safeHttpUrl(movie.imageSrc);
  return {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    ...(image ? { image } : {}),
    ...(movie.genres.length ? { genre: movie.genres } : {}),
    url: `${SITE_ORIGIN}${movieLink(movie)}`,
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

async function getMoviePage(routeCode: string, instant = new Date()) {
  const selection = resolvePreviewRouteSelection(routeCode, instant);
  if (!selection) return null;
  const repository = getProductionPublicDataRepository();

  return withPublicationSnapshot(repository, async () => {
    const result = await getMovieByPermanentCode(
      repository,
      selection.movieCode,
    );
    if (!result) return null;
    const { movie, isComingSoon } = result;
    const parsedRoute = parseMovieRouteCode(routeCode);
    let rows: TicketAvailabilityShowtime[] = [];
    if (!isComingSoon) {
      const fromDate = getCinemaDayDate(instant);
      rows = await getTicketAvailabilityShowtimes(
        repository,
        movie.tmdbId,
        fromDate,
      );
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
    const shownRows = rows.slice(0, MAX_SCREENINGS_PER_PAGE);
    const screeningItems = shownRows
      .map((row) => {
        const cinemaIdentity = findCinemaIdentityForScreening(
          row.screeningCity,
          row.cinema,
        );
        const hasCurrentTheater = cinemaIdentity
          ? findTheaterByCinemaId(theaters.theaters, cinemaIdentity.id) !== null
          : false;
        const cinemaHref =
          cinemaIdentity && hasCurrentTheater ? `/c/${cinemaIdentity.id}` : "";
        const cinemaLabel = cinemaIdentity?.displayName ?? row.cinema;
        return `<li><strong>${escapeHtml(row.screeningCity)}</strong> · ${cinemaHref ? `<a href="${escapeHtml(cinemaHref)}">${escapeHtml(cinemaLabel)}</a>` : escapeHtml(row.cinema)} · ${escapeHtml(row.dateOfShowing)} ${escapeHtml(row.showtime)}${bookingLink(row.englishHref)}</li>`;
      })
      .join("");
    const posterUrl = safeHttpUrl(movie.imageSrc);
    const isEncodedSelection = parsedRoute?.kind === "encoded";
    const selectedShowtimes = rows
      .slice(0, 2)
      .map((row) => `${row.cinema} at ${row.showtime}`)
      .join(" · ");
    const description = isEncodedSelection
      ? `${movie.title} showtimes in ${selection.city} on ${selection.date}${selectedShowtimes ? `: ${selectedShowtimes}` : ". No showtimes are listed for this selection"}.`
      : `${movie.title}${movie.year ? ` (${movie.year})` : ""}. ${isComingSoon ? "Coming soon information" : "Find upcoming movie showtimes at cinemas across Israel"} on Kartiseret.`;
    const openGraphImageUrl = isEncodedSelection
      ? `${SITE_ORIGIN}/api/og-image?routeCode=${encodeURIComponent(routeCode)}`
      : posterUrl;
    const body = `<main><article><h1>${escapeHtml(movie.title)}</h1><p>${isComingSoon ? "Coming soon" : "Movie listings and upcoming showtimes across Israel"}${movie.year ? ` · ${movie.year}` : ""}</p>${posterUrl ? `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(`${movie.title} poster`)}" width="300" height="450" loading="eager" />` : ""}<dl>${movie.runtime ? `<dt>Runtime</dt><dd>${movie.runtime} minutes</dd>` : ""}${movie.genres.length ? `<dt>Genres</dt><dd>${movie.genres.map(escapeHtml).join(", ")}</dd>` : ""}${movie.releaseDate ? `<dt>Release date</dt><dd>${escapeHtml(movie.releaseDate)}</dd>` : ""}</dl><h2>${isComingSoon ? "Movie information" : "Upcoming showtimes"}</h2>${screeningItems ? `<ul>${screeningItems}</ul>` : `<p>${isComingSoon ? "Showtimes have not been listed yet." : "No upcoming showtimes are currently listed."}</p>`}${rows.length > shownRows.length ? `<p>Showing ${shownRows.length} of the upcoming listings.</p>` : ""}</article></main>`;
    return {
      movie,
      isComingSoon,
      page: {
        title: `${movie.title}${isComingSoon ? " — Coming soon" : " showtimes in Israel"} | Kartiseret`,
        description,
        canonicalPath: `/${selection.movieCode}`,
        openGraphPath: `/${routeCode}`,
        imageUrl: openGraphImageUrl,
        imageAlt: isEncodedSelection
          ? `${movie.title} showtimes in ${selection.city}`
          : `${movie.title} poster`,
        body,
        jsonLd: movieJsonLd(movie),
      },
    };
  });
}

async function getCinemaPage(cinemaId: string, instant = new Date()) {
  const repository = getProductionPublicDataRepository();
  return withPublicationSnapshot(repository, async () => {
    const theaterData = await getPublicTheaterData(repository);
    const identity = getCinemaIdentityById(cinemaId);
    if (!identity) return null;
    const theater = findTheaterByCinemaId(theaterData.theaters, cinemaId);
    if (!theater) return null;
    const startDate = getCinemaDayDate(instant);
    const endDate = dayOffset(startDate, 13);
    const screeningCities = [...new Set(identity.screeningCityKeys)];
    const [showtimesByCity, nowPlaying, comingSoon, thequeByCity] =
      await Promise.all([
        Promise.all(
          screeningCities.map((city) =>
            getShowtimeRange(repository, {
              city: city as typeof DEFAULT_LOCATION,
              startDate,
              endDate,
            })),
        ),
        getMovieCatalog(repository, "nowPlaying"),
        getMovieCatalog(repository, "comingSoon"),
        Promise.all(
          screeningCities.map((city) =>
            getCinemathequeData(repository, {
              city: city as typeof DEFAULT_LOCATION,
              startDate,
              endDate,
            })),
        ),
      ]);
    const candidateRows = [
      ...showtimesByCity.flat(),
      ...thequeByCity.flatMap((data) => data.showtimes),
    ];
    const uniqueRows = [
      ...new Map(
        candidateRows.map((row) => [
          [
            row.tmdbId,
            row.screeningCity,
            row.dateOfShowing,
            row.showtime,
            row.cinema,
          ].join("\0"),
          row,
        ]),
      ).values(),
    ];
    const rows = uniqueRows
      .filter(
        (row) =>
          findCinemaIdentityForScreening(row.screeningCity, row.cinema)?.id ===
          identity.id,
      )
      .filter((row) =>
        shouldIncludeShowtime(
          row.dateOfShowing,
          normalizeShowtime(row.showtime),
          instant,
        ))
      .sort(compareShowtimes);
    const movies = new Map<string, Movie>();
    for (const movie of [
      ...nowPlaying.movies,
      ...comingSoon.movies,
      ...thequeByCity.flatMap((data) => data.movies),
    ]) {
      if (!movies.has(movie.tmdbId)) movies.set(movie.tmdbId, movie);
    }
    const publicMovieIds = new Set(
      [...nowPlaying.movies, ...comingSoon.movies]
        .filter((movie) => movie.movieCode)
        .map((movie) => movie.tmdbId),
    );
    const relevant = rows
      .flatMap((row) => {
        const movie = movies.get(row.tmdbId);
        return movie ? [{ row, movie }] : [];
      })
      .slice(0, MAX_SCREENINGS_PER_PAGE);
    const grouped = new Map<string, { movie: Movie; rows: PublicShowtime[] }>();
    for (const { row, movie } of relevant) {
      const entry = grouped.get(movie.tmdbId) ?? { movie, rows: [] };
      entry.rows.push(row);
      grouped.set(movie.tmdbId, entry);
    }
    const screeningList = [...grouped.values()]
      .map(
        ({ movie, rows: movieRows }) =>
          `<li>${
            movie.movieCode && publicMovieIds.has(movie.tmdbId)
              ? `<a href="${escapeHtml(movieLink(movie))}">${escapeHtml(movie.title)}</a>`
              : escapeHtml(movie.title)
          }<ul>${movieRows
            .slice(0, 8)
            .map(
              (row) =>
                `<li>${escapeHtml(row.dateOfShowing)} at ${escapeHtml(row.showtime)}${bookingLink(row.englishHref)}</li>`,
            )
            .join("")}</ul></li>`,
      )
      .join("");
    const address = theater.address.trim();
    const body = `<main><article><h1>${escapeHtml(identity.displayName)}</h1><p>${escapeHtml(identity.city)}</p>${address ? `<p>${escapeHtml(address)}</p>` : ""}<h2>Upcoming movie showtimes</h2>${screeningList ? `<ul>${screeningList}</ul>` : "<p>No upcoming showtimes are currently listed for this cinema.</p>"}<p><a href="/showtimes">Browse showtimes</a></p></article></main>`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "MovieTheater",
      name: identity.displayName,
      url: `${SITE_ORIGIN}/c/${cinemaId}`,
      address: {
        "@type": "PostalAddress",
        ...(address ? { streetAddress: address } : {}),
        addressLocality: identity.city,
        addressCountry: "IL",
      },
      ...(typeof theater.lat === "number" && typeof theater.lng === "number"
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: theater.lat,
              longitude: theater.lng,
            },
          }
        : {}),
    };
    return {
      page: {
        title: `${identity.displayName}${address ? `, ${address}` : ""} showtimes in ${identity.city} | Kartiseret`,
        description: `Upcoming movie listings at ${identity.displayName} in ${identity.city}.`,
        canonicalPath: `/c/${cinemaId}`,
        body,
        jsonLd,
      },
    };
  });
}

async function buildListingPage(
  repository: ReturnType<typeof getProductionPublicDataRepository>,
  path: string,
) {
  let title = "Kartiseret movie listings";
  let description =
    "Browse movie listings and showtimes across Israeli cinemas.";
  let heading = "Movie listings";
  let content = "";
  let jsonLd: unknown;
  let indexable = false;
  if (path === "/movies" || path === "/soons") {
    const mode = path === "/movies" ? "nowPlaying" : "comingSoon";
    const catalog = await getMovieCatalog(repository, mode);
    title =
      path === "/movies"
        ? "Movies showing in Israel | Kartiseret"
        : "Coming soon movies in Israel | Kartiseret";
    description =
      path === "/movies"
        ? "Browse movies showing at cinemas across Israel."
        : "Browse upcoming movie releases and details on Kartiseret.";
    heading =
      path === "/movies" ? "Movies showing in Israel" : "Coming soon movies";
    content = movieListHtml(catalog.movies);
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
          url: `${SITE_ORIGIN}${movieLink(movie)}`,
          name: movie.title,
        })),
    };
  } else if (path === "/cinematheques") {
    const [data, nowPlaying, comingSoon] = await Promise.all([
      getCinemathequeData(repository, {
        city: DEFAULT_LOCATION,
        startDate: getCinemaDayDate(),
      }),
      getMovieCatalog(repository, "nowPlaying"),
      getMovieCatalog(repository, "comingSoon"),
    ]);
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
    heading = "Cinematheque movie showtimes";
    content = movieListHtml(movies);
    indexable = movies.length > 0;
  } else if (path === "/showtimes") {
    const startDate = getCinemaDayDate();
    const endDate = dayOffset(startDate, 6);
    const [rows, catalog] = await Promise.all([
      getShowtimeRange(repository, {
        city: DEFAULT_LOCATION,
        startDate,
        endDate,
      }),
      getMovieCatalog(repository, "nowPlaying"),
    ]);
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
    heading = `Upcoming showtimes in ${DEFAULT_LOCATION}`;
    content = `<ul>${[...grouped.values()]
      .slice(0, 80)
      .map(
        ({ movie, rows: movieRows }) =>
          `<li><a href="${escapeHtml(movieLink(movie))}">${escapeHtml(movie.title)}</a> — ${movieRows.length} listed screening${movieRows.length === 1 ? "" : "s"}</li>`,
      )
      .join("")}</ul>`;
    indexable = grouped.size > 0;
  }
  return {
    indexable,
    page: {
      title,
      description,
      canonicalPath: path,
      body: `<main><h1>${escapeHtml(heading)}</h1>${content}</main>`,
      jsonLd,
      noindex: !indexable,
    },
  };
}

async function getListingPage(path: string) {
  const repository = getProductionPublicDataRepository();
  return withPublicationSnapshot(repository, () =>
    buildListingPage(repository, path));
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
    let result: { page: Parameters<typeof injectSeoPage>[1] } | null = null;
    if (route === "movie") {
      const routeCode = Array.isArray(request.query.routeCode)
        ? (request.query.routeCode.at(-1) ?? "")
        : (request.query.routeCode ?? "");
      const movie = await getMoviePage(routeCode);
      result = movie ? { page: movie.page } : null;
    } else if (route === "cinema") {
      const cinemaId = Array.isArray(request.query.cinemaId)
        ? (request.query.cinemaId.at(-1) ?? "")
        : (request.query.cinemaId ?? "");
      if (!/^[A-Za-z0-9_-]{12}$/.test(cinemaId)) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex")
          .setHeader("Cache-Control", "no-store")
          .send("Cinema not found.");
        return;
      }
      result = await getCinemaPage(cinemaId);
    } else if (route === "page") {
      const path = Array.isArray(request.query.path)
        ? (request.query.path.at(-1) ?? "")
        : (request.query.path ?? "");
      if (
        !["/movies", "/soons", "/showtimes", "/cinematheques"].includes(path)
      ) {
        response
          .status(404)
          .setHeader("Content-Type", "text/plain; charset=utf-8")
          .setHeader("X-Robots-Tag", "noindex")
          .setHeader("Cache-Control", "no-store")
          .send("Page not found.");
        return;
      }
      result = await getListingPage(path);
    }
    if (!result) {
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
    const output = injectSeoPage(html, result.page);
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
