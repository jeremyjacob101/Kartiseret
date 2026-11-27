import { addCalendarDays, buildMovieShowtimeShareUrl } from "@kartiseret/contracts/showtime-links";
import { DEFAULT_SHOWTIME_PREFERENCES } from "@kartiseret/contracts/showtime-preferences";
import { getShowtimesCityFromPath } from "@kartiseret/contracts/showtime-routes";
import { publicPageBootstrapSchema } from "@kartiseret/contracts/public-render";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { getCinemaDayDate } from "@kartiseret/contracts/showtime-day";
import { DEFAULT_LOCATION } from "@kartiseret/contracts/preferences";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { resolve } from "node:path";

export const { renderPublicApplication } =
  await import("../../dist-ssr/entry-server.js");
const cinemaIdentity = CINEMA_IDENTITIES.find(
  (identity) => identity.displayName === "Cinema City Jerusalem",
);
assert.ok(
  cinemaIdentity,
  "The SSR fixture requires a verified Jerusalem cinema.",
);

const isStandalone =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
const renderedAt = isStandalone
  ? "2026-11-26T12:00:00.000Z"
  : new Date().toISOString();
const today = getCinemaDayDate(new Date(renderedAt));
const weekEnd = addCalendarDays(today, 6);
assert.ok(weekEnd);

const movie = {
  tmdbId: "101",
  movieCode: "Ab1",
  publicRouteCode: "movie000",
  imdbId: "tt1234567",
  rtId: "/m/sample_movie",
  lbId: "/film/sample-movie/",
  title: "SSR Test Movie",
  year: 2026,
  releaseDate: today,
  genres: ["Drama", "Comedy"],
  imageSrc: "https://images.example.test/poster.jpg",
  backdropSrc: "https://images.example.test/backdrop.jpg",
  trailerKey: "testTrailerKey",
  imdbRating: null,
  lbRating: null,
  lbVotes: null,
  tmdbRating: null,
  tmdbVotes: null,
  rtCriticRating: null,
  rtCriticVotes: null,
  rtAudienceRating: null,
  rtAudienceVotes: null,
  runtime: 125,
  popularity: 42.5,
  altOptions: [],
};
const comingSoonMovie = {
  ...movie,
  tmdbId: "102",
  movieCode: "Cd2",
  publicRouteCode: "soon0000",
  title: "SSR Coming Soon Movie",
};
const screening = {
  tmdbId: movie.tmdbId,
  screeningCity: DEFAULT_LOCATION,
  dateOfShowing: today,
  cinema: "Cinema City",
  showtime: "23:59",
  englishHref: "https://tickets.example.test/booking",
  hebrewHref: null,
  screeningTech: "2D",
  screeningType: "Regular",
  dubLanguage: null,
};

function route(code, kind, destinationId, renderPath, payload = {}) {
  return {
    code,
    destinationKey: `${kind}:${destinationId}`,
    kind,
    destinationId,
    payload,
    renderPath,
  };
}

const encodedUrl = buildMovieShowtimeShareUrl({
  movieCode: "Ab1",
  city: DEFAULT_LOCATION,
  date: today,
  filterMask: 0,
});
assert.ok(encodedUrl);
export const encodedPath = new URL(encodedUrl).pathname;

export const publicRouteFixtures = new Map([
  ["home0000", route("home0000", "page", "/", "/")],
  ["movies00", route("movies00", "page", "/movies", "/movies")],
  ["soons000", route("soons000", "page", "/soons", "/soons")],
  ["show0000", route("show0000", "page", "/showtimes", "/showtimes")],
  ["jeru0000", route("jeru0000", "city", "Jerusalem", "/showtimes/jerusalem")],
  ["theques0", route("theques0", "page", "/cinematheques", "/cinematheques")],
  ["movie000", route("movie000", "movie", "Ab1", "/Ab1")],
  ["soon0000", route("soon0000", "movie", "Cd2", "/Cd2")],
  [
    "cinema00",
    route(
      "cinema00",
      "cinema",
      cinemaIdentity.id,
      `/__cinema/${cinemaIdentity.id}`,
    ),
  ],
  [
    "share000",
    route("share000", "share", "Ab1", encodedPath, {
      movieCode: "Ab1",
      city: DEFAULT_LOCATION,
      date: today,
      filterMask: 0,
      excludedCinemaIds: [],
    }),
  ],
]);

export const legacyPathToCode = new Map([
  ["/", "home0000"],
  ["/movies", "movies00"],
  ["/soons", "soons000"],
  ["/showtimes", "show0000"],
  ["/showtimes/jerusalem", "jeru0000"],
  ["/cinematheques", "theques0"],
  ["/Ab1", "movie000"],
  ["/Cd2", "soon0000"],
]);
const theaters = {
  cities: [
    {
      name: DEFAULT_LOCATION,
      altSpellings: [],
      latitude: 31.78,
      longitude: 35.2,
      zoomLayer: 10,
      neighboringCities: [],
    },
  ],
  theaters: [
    {
      city: {
        name: DEFAULT_LOCATION,
        altSpellings: [],
        latitude: 31.78,
        longitude: 35.2,
        zoomLayer: 10,
        neighboringCities: [],
      },
      chain: "Cinema City",
      address: "1 Cinema Street",
      theaterName: cinemaIdentity.displayName,
      location: cinemaIdentity.locationKeys[0],
      lat: 31.78,
      lng: 35.2,
    },
  ],
};

export function makeBootstrap(pathname) {
  const route = publicRouteFixtures.get(pathname.slice(1));
  const renderPath = route?.renderPath ?? pathname;
  const showtimeCity =
    renderPath === "/showtimes"
      ? DEFAULT_LOCATION
      : getShowtimesCityFromPath(renderPath);
  return publicPageBootstrapSchema.parse({
    version: 1,
    pathname,
    ...(route
      ? {
          resolvedRoute: {
            route: {
              code: route.code,
              destinationKey: route.destinationKey,
              kind: route.kind,
              destinationId: route.destinationId,
              payload: route.payload,
            },
            renderPath: route.renderPath,
          },
        }
      : {}),
    renderedAt,
    publicationRevision: "7",
    catalogs: renderPath.startsWith("/Ab1")
      ? {}
      : {
          nowPlaying: {
            mode: "nowPlaying",
            movies: [movie],
            movieCodesStatus: "ready",
            publicationRevision: "7",
          },
          comingSoon: {
            mode: "comingSoon",
            movies: [comingSoonMovie],
            movieCodesStatus: "ready",
            publicationRevision: "7",
          },
        },
    theaters,
    ...(renderPath.startsWith("/Ab1")
      ? { movieDetail: { movie, mode: "nowPlaying" } }
      : {}),
    ...(showtimeCity
      ? {
          showtimeCity: {
            city: showtimeCity,
            startDate: today,
            endDate: weekEnd,
            showtimes: [{ ...screening, screeningCity: showtimeCity }],
          },
        }
      : {}),
    ...(renderPath === "/cinematheques"
      ? {
          cinematheques: {
            city: DEFAULT_LOCATION,
            publicationRevision: "7",
            data: {
              movies: [movie],
              movieCodesStatus: "ready",
              showtimes: [screening],
            },
          },
        }
      : {}),
    ...(renderPath === `/__cinema/${cinemaIdentity.id}`
      ? {
          cinema: {
            id: cinemaIdentity.id,
            displayName: cinemaIdentity.displayName,
            city: cinemaIdentity.city,
            address: "1 Cinema Street",
            mapUrl: "https://maps.example.test/cinema",
            latitude: 31.78,
            longitude: 35.2,
            screenings: [{ movie, screening }],
          },
        }
      : {}),
    ...(renderPath === "/Ab1"
      ? {
          targetedMovieShowtimes: {
            city: DEFAULT_LOCATION,
            date: today,
            tmdbId: movie.tmdbId,
            showtimes: [screening],
          },
        }
      : {}),
  });
}

export const cases = [
  ["/home0000", "Now Playing"],
  ["/movies00", "SSR Test Movie"],
  ["/soons000", "SSR Coming Soon Movie"],
  ["/show0000", "SSR Test Movie"],
  ["/jeru0000", "Movie showtimes in Jerusalem"],
  ["/theques0", "Cinematheque Showtimes"],
  ["/movie000", "SSR Test Movie"],
  ["/cinema00", cinemaIdentity.displayName],
  ["/share000", "SSR Test Movie"],
];

if (isStandalone) {
  for (const [pathname, expectedContent] of cases) {
    const markup = await renderPublicApplication(makeBootstrap(pathname));
    assert.ok(
      markup.includes('class="app-shell"'),
      `${pathname} has the real app shell`,
    );
    assert.ok(
      markup.includes(expectedContent),
      `${pathname} has ${expectedContent}`,
    );
    if (pathname === "/home0000") {
      assert.ok(
        markup.includes('href="/movie000"'),
        "Home links to the opaque movie route before hydration",
      );
      assert.ok(
        markup.includes("home-poster-row"),
        "Home renders its poster row",
      );
    }
    assert.ok(
      !markup.includes("seo-content"),
      `${pathname} has no separate SEO fallback`,
    );
  }

  const privateHomeMarkup = await renderPublicApplication(
    makeBootstrap("/home0000"),
    12_000,
    {
      version: 1,
      accountKey: "0".repeat(64),
      preferences: {
        location: DEFAULT_LOCATION,
        ratingSources: [],
        siteColor: "#69b0e2",
        hideReReleases: true,
        notificationDelivery: "email",
        showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
      },
      movieTreatments: [
        {
          tmdbId: movie.tmdbId,
          title: movie.title,
          releaseYear: null,
          treatment: "remove",
          hideBackdrop: false,
        },
      ],
    },
  );
  assert.ok(!privateHomeMarkup.includes('href="/movie000"'));
  assert.ok(!privateHomeMarkup.includes(">Re-Releases</h2>"));
  assert.ok(privateHomeMarkup.includes('href="/soon0000"'));

  const movieListingMarkup = await renderPublicApplication(
    makeBootstrap("/movies00"),
  );
  assert.ok(movieListingMarkup.includes('href="/movie000"'));
  const cinemaMarkup = await renderPublicApplication(
    makeBootstrap("/cinema00"),
  );
  assert.ok(cinemaMarkup.includes('href="/movie000"'));

  const encodedMarkup = await renderPublicApplication(
    makeBootstrap("/share000"),
  );
  assert.ok(encodedMarkup.includes("SSR Test Movie"));

  console.log(
    "Built SSR output renders home, listings, showtimes, movie, encoded movie and cinema routes.",
  );
}
