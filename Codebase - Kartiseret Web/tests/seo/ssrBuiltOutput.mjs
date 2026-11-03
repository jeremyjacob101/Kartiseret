import { addCalendarDays, buildMovieShowtimeShareUrl } from "@kartiseret/contracts/showtime-links";
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

const renderedAt = new Date().toISOString();
const today = getCinemaDayDate(new Date(renderedAt));
const weekEnd = addCalendarDays(today, 6);
assert.ok(weekEnd);

const movie = {
  tmdbId: "101",
  movieCode: "Ab1",
  imdbId: "tt1234567",
  rtId: "/m/sample_movie",
  lbId: "/film/sample-movie/",
  title: "SSR Test Movie",
  year: 2026,
  releaseDate: "2026-09-18",
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
  return publicPageBootstrapSchema.parse({
    version: 1,
    pathname,
    renderedAt,
    publicationRevision: "7",
    catalogs: {
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
    ...(pathname === "/showtimes"
      ? {
          showtimeCity: {
            city: DEFAULT_LOCATION,
            startDate: today,
            endDate: weekEnd,
            showtimes: [screening],
          },
        }
      : {}),
    ...(pathname === "/cinematheques"
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
    ...(pathname === `/c/${cinemaIdentity.id}`
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
    ...(pathname === "/Ab1"
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
  ["/", "Now Playing"],
  ["/movies", "SSR Test Movie"],
  ["/soons", "SSR Coming Soon Movie"],
  ["/showtimes", "SSR Test Movie"],
  ["/cinematheques", "Cinematheque Showtimes"],
  ["/Ab1", "SSR Test Movie"],
  [`/c/${cinemaIdentity.id}`, cinemaIdentity.displayName],
];

export const encodedUrl = buildMovieShowtimeShareUrl({
  movieCode: "Ab1",
  city: DEFAULT_LOCATION,
  date: today,
  filterMask: 0,
});
assert.ok(encodedUrl);
export const encodedPath = new URL(encodedUrl).pathname;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
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
    assert.ok(
      !markup.includes("seo-content"),
      `${pathname} has no separate SEO fallback`,
    );
  }

  const movieListingMarkup = await renderPublicApplication(
    makeBootstrap("/movies"),
  );
  assert.ok(movieListingMarkup.includes('href="/Ab1"'));
  const cinemaMarkup = await renderPublicApplication(
    makeBootstrap(`/c/${cinemaIdentity.id}`),
  );
  assert.ok(cinemaMarkup.includes('href="/Ab1"'));

  const encodedMarkup = await renderPublicApplication(
    makeBootstrap(encodedPath),
  );
  assert.ok(encodedMarkup.includes("SSR Test Movie"));

  console.log(
    "Built SSR output renders home, listings, showtimes, movie, encoded movie and cinema routes.",
  );
}
