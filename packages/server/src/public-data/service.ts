import { timeCatalogStage } from "../catalog-timing.js";
import {
  movieCatalogModeSchema,
  movieCatalogDataSchema,
  publicShowtimeSchema,
  publicTheaterDataSchema,
  ticketAvailabilityShowtimeSchema,
  type MovieCatalogData,
  type MovieCatalogMode,
  type PublicShowtime,
  type PublicShowtimeRangeQuery,
  type PublicTheaterData,
  type TicketAvailabilityShowtime,
} from "@kartiseret/contracts/public-data";
import {
  httpUrlSchema,
  movieCodeSchema,
  parseBoundary,
  tmdbIdSchema,
} from "@kartiseret/contracts/runtime";
import {
  movieSchema,
  type Movie,
  citySchema,
  theaterSchema,
} from "@kartiseret/contracts/movies";
import { CatalogDataIntegrityError } from "../catalog/errors.js";
import {
  toComingSoonMovie,
  toNowPlayingMovie,
} from "../catalog/movie-mapper.js";
import type { PublicDataRepository } from "./repository.js";
import { PublicDataIntegrityError } from "./errors.js";
import { z } from "zod";

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function comparePopularityDescending(left: unknown, right: unknown): number {
  const leftValue = numericValue(left);
  const rightValue = numericValue(right);
  if (leftValue === null || rightValue === null) {
    if (leftValue !== rightValue) {
      return leftValue === null ? 1 : -1;
    }
    return 0;
  }
  return rightValue - leftValue;
}

function compareTmdbIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareNowPlayingRows(left: unknown, right: unknown): number {
  return (
    comparePopularityDescending(
      readField(left, "popularity"),
      readField(right, "popularity"),
    ) ||
    compareTmdbIds(
      tmdbIdSchema.parse(readField(left, "tmdbId")),
      tmdbIdSchema.parse(readField(right, "tmdbId")),
    )
  );
}

function compareComingSoonRows(left: unknown, right: unknown): number {
  const leftReleaseDate = String(readField(left, "releaseDate") ?? "");
  const rightReleaseDate = String(readField(right, "releaseDate") ?? "");
  const leftTitle = String(readField(left, "englishTitle") ?? "").trim();
  const rightTitle = String(readField(right, "englishTitle") ?? "").trim();

  return (
    leftReleaseDate.localeCompare(rightReleaseDate) ||
    comparePopularityDescending(
      readField(left, "popularity"),
      readField(right, "popularity"),
    ) ||
    leftTitle.localeCompare(rightTitle) ||
    compareTmdbIds(
      tmdbIdSchema.parse(readField(left, "tmdbId")),
      tmdbIdSchema.parse(readField(right, "tmdbId")),
    )
  );
}

function buildMovieCodeIndex(
  rows: readonly unknown[],
  movieCodes: ReadonlyMap<string, string>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    const tmdbId = tmdbIdSchema.parse(readField(row, "tmdbId"));
    const movieCode = movieCodes.get(tmdbId);
    if (movieCode === undefined) {
      continue;
    }
    const parsedCode = movieCodeSchema.safeParse(movieCode);
    if (!parsedCode.success) {
      throw new CatalogDataIntegrityError(
        "A movie code row does not match the public route-code format.",
        parsedCode.error,
      );
    }
    index.set(tmdbId, parsedCode.data);
  }
  return index;
}

export async function getMovieCatalog(
  repository: PublicDataRepository,
  mode: MovieCatalogMode,
  onCodeLookupFailure?: (error: unknown) => void,
): Promise<MovieCatalogData> {
  const parsedMode = parseBoundary(
    movieCatalogModeSchema,
    mode,
    "movie catalog mode",
  );
  const rows = await timeCatalogStage("movie_rows", async () =>
    parsedMode === "nowPlaying"
      ? [...(await repository.findNowPlayingRows())]
      : [...(await repository.findComingSoonRows())],
  );
  const visibleRows = rows.filter((row) => {
    const pending = readField(row, "soloUpdate");
    return (
      pending !== true &&
      pending !== 1 &&
      pending !== "true" &&
      pending !== "t" &&
      pending !== "1"
    );
  });
  const orderedRows = visibleRows.sort(
    parsedMode === "nowPlaying" ? compareNowPlayingRows : compareComingSoonRows,
  );

  const ids = orderedRows.map((row) =>
    tmdbIdSchema.parse(readField(row, "tmdbId")),
  );
  let codeMap: ReadonlyMap<string, string> = new Map();
  let movieCodesStatus: MovieCatalogData["movieCodesStatus"] = "ready";

  try {
    codeMap = await timeCatalogStage("movie_codes", () =>
      repository.findMovieCodes(ids),
    );
  } catch (error) {
    movieCodesStatus = "failed";
    onCodeLookupFailure?.(error);
  }

  const codeIndex = buildMovieCodeIndex(orderedRows, codeMap);
  const movies = orderedRows.map((row) => {
    const tmdbId = tmdbIdSchema.parse(readField(row, "tmdbId"));
    const movieCode = codeIndex.get(tmdbId);
    return parsedMode === "nowPlaying"
      ? toNowPlayingMovie(row, movieCode)
      : toComingSoonMovie(row, movieCode);
  });

  return parseBoundary(
    movieCatalogDataSchema,
    { mode: parsedMode, movies, movieCodesStatus },
    `${parsedMode} catalog response`,
  );
}

const databaseShowtimeRowSchema = z.object({
  tmdbId: z.union([z.number().int(), z.null()]),
  screeningCity: z.string().nullable(),
  dateOfShowing: z.string().nullable(),
  cinema: z.string().nullable(),
  showtime: z.string().nullable(),
  englishHref: z.string().nullable(),
  hebrewHref: z.string().nullable(),
  screeningTech: z.string().nullable(),
  screeningType: z.string().nullable(),
  dubLanguage: z.string().nullable(),
});

function normalizeLocalTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const match = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(
    value.trim(),
  );
  if (!match) {
    return value;
  }
  return `${match[1]!.padStart(2, "0")}:${match[2]}`;
}

function normalizeHttpUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const result = httpUrlSchema.safeParse(value);
  return result.success ? result.data : null;
}

function mapDatabaseShowtime(value: unknown): PublicShowtime {
  const row = databaseShowtimeRowSchema.safeParse(value);
  if (!row.success) {
    throw new CatalogDataIntegrityError(
      "A showtime row does not match the expected database shape.",
      row.error,
    );
  }
  const normalized = publicShowtimeSchema.safeParse({
    tmdbId: row.data.tmdbId,
    screeningCity: row.data.screeningCity?.trim(),
    dateOfShowing: row.data.dateOfShowing,
    cinema: row.data.cinema?.trim(),
    showtime: normalizeLocalTime(row.data.showtime),
    englishHref: normalizeHttpUrl(row.data.englishHref),
    hebrewHref: normalizeHttpUrl(row.data.hebrewHref),
    screeningTech: row.data.screeningTech ?? "",
    screeningType: row.data.screeningType ?? "",
    dubLanguage: row.data.dubLanguage,
  });
  if (!normalized.success) {
    throw new CatalogDataIntegrityError(
      "A showtime row could not be normalized for the public API.",
      normalized.error,
    );
  }
  return normalized.data;
}

export async function getShowtimeRange(
  repository: PublicDataRepository,
  range: PublicShowtimeRangeQuery,
): Promise<PublicShowtime[]> {
  const rows = await repository.findShowtimeRows(range);
  return rows
    .filter((value) => {
      const tmdbId = readField(value, "tmdbId");
      const city = readField(value, "screeningCity");
      const date = readField(value, "dateOfShowing");
      const cinema = readField(value, "cinema");
      const showtime = readField(value, "showtime");

      // These physical columns are nullable. Rows without a movie, city,
      // theater, date, or local time cannot appear in the existing UI and are
      // omitted just as the former browser mapper omitted incomplete rows.
      return (
        tmdbId !== null &&
        city !== null &&
        typeof city === "string" &&
        city.trim().length > 0 &&
        date !== null &&
        cinema !== null &&
        typeof cinema === "string" &&
        cinema.trim().length > 0 &&
        showtime !== null &&
        typeof showtime === "string" &&
        showtime.trim().length > 0
      );
    })
    .map(mapDatabaseShowtime);
}

export async function getTicketAvailabilityShowtimes(
  repository: PublicDataRepository,
  tmdbId: string,
  fromDate: string,
): Promise<TicketAvailabilityShowtime[]> {
  const rows = await repository.findTicketAvailabilityRows(tmdbId, fromDate);
  return rows.flatMap((row) => {
    const parsedRow = databaseShowtimeRowSchema.safeParse(row);
    if (!parsedRow.success) {
      return [];
    }
    const normalized = ticketAvailabilityShowtimeSchema.safeParse({
      screeningCity: parsedRow.data.screeningCity?.trim(),
      dateOfShowing: parsedRow.data.dateOfShowing,
      cinema: parsedRow.data.cinema?.trim(),
      showtime: normalizeLocalTime(parsedRow.data.showtime),
      englishHref: normalizeHttpUrl(parsedRow.data.englishHref),
      hebrewHref: normalizeHttpUrl(parsedRow.data.hebrewHref),
      screeningTech: parsedRow.data.screeningTech ?? "",
      screeningType: parsedRow.data.screeningType ?? "",
      dubLanguage: parsedRow.data.dubLanguage,
    });
    if (
      !normalized.success ||
      (!normalized.data.englishHref && !normalized.data.hebrewHref)
    ) {
      return [];
    }
    return [normalized.data];
  });
}

const theaterCityRowSchema = z.object({
  chain: z.string().nullable(),
  address: z.string().nullable(),
  location: z.string().nullable(),
  theaterName: z.string().nullable(),
  theaterLatitude: z.number().nullable(),
  theaterLongitude: z.number().nullable(),
  cityName: z.string().nullable(),
  altSpellings: z.array(z.string()).nullable(),
  cityLatitude: z.number().nullable(),
  cityLongitude: z.number().nullable(),
  zoomLayer: z.number().nullable(),
  neighboringCities: z.array(z.string()).nullable(),
});

function mapTheaterCityRows(rows: readonly unknown[]): PublicTheaterData {
  const cityByName = new Map<string, z.infer<typeof citySchema>>();
  const theaters = [] as z.infer<typeof theaterSchema>[];

  for (const value of rows) {
    const row = theaterCityRowSchema.safeParse(value);
    if (!row.success) {
      throw new PublicDataIntegrityError(
        "invalid_theater_metadata",
        "A theater record has invalid nullable metadata.",
        row.error,
      );
    }

    if (row.data.cityName === null) {
      if (row.data.location !== null) {
        throw new PublicDataIntegrityError(
          "orphaned_theater",
          "A theater row no longer joins to its referenced city.",
        );
      }
      continue;
    }

    const cityResult = citySchema.safeParse({
      name: row.data.cityName,
      altSpellings: row.data.altSpellings,
      latitude: row.data.cityLatitude,
      longitude: row.data.cityLongitude,
      zoomLayer: row.data.zoomLayer,
      neighboringCities: row.data.neighboringCities,
    });
    if (!cityResult.success) {
      throw new PublicDataIntegrityError(
        "invalid_city_metadata",
        "A city record has invalid nullable map metadata.",
        cityResult.error,
      );
    }
    cityByName.set(cityResult.data.name, cityResult.data);

    if (row.data.location === null) {
      continue;
    }

    const theaterResult = theaterSchema.safeParse({
      city: cityResult.data,
      chain: row.data.chain,
      address: row.data.address,
      theaterName: row.data.theaterName,
      location: row.data.location,
      lat: row.data.theaterLatitude,
      lng: row.data.theaterLongitude,
    });
    if (!theaterResult.success) {
      throw new PublicDataIntegrityError(
        "invalid_theater_metadata",
        "A theater record has invalid nullable map metadata.",
        theaterResult.error,
      );
    }
    theaters.push(theaterResult.data);
  }

  theaters.sort(
    (left, right) =>
      left.city.name.localeCompare(right.city.name) ||
      left.chain.localeCompare(right.chain) ||
      left.address.localeCompare(right.address) ||
      left.location.localeCompare(right.location),
  );
  const cities = [...cityByName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  return parseBoundary(
    publicTheaterDataSchema,
    { cities, theaters },
    "theater and city response",
  );
}

export async function getPublicTheaterData(
  repository: PublicDataRepository,
): Promise<PublicTheaterData> {
  return mapTheaterCityRows(await repository.findTheaterCityRows());
}

export async function getMovieByPermanentCode(
  repository: PublicDataRepository,
  movieCode: string,
): Promise<{ movie: Movie; isComingSoon: boolean } | null> {
  const parsedCode = parseBoundary(movieCodeSchema, movieCode, "movie code");
  const tmdbId = await repository.findMovieCodeByCode(parsedCode);
  if (tmdbId === null) {
    return null;
  }

  const parsedId = parseBoundary(tmdbIdSchema, tmdbId, "movie code TMDB ID");
  // finalMovies/finalSoons use PostgreSQL integer columns. movieCodes stores
  // bigint, so a syntactically valid code can still point outside that range.
  // Avoid lossy numeric casts or querying a rounded identifier.
  if (BigInt(parsedId) > 2_147_483_647n) {
    return null;
  }
  const [nowPlayingRow, comingSoonRow] = await Promise.all([
    repository.findNowPlayingMovieById(parsedId),
    repository.findComingSoonMovieById(parsedId),
  ]);
  if (nowPlayingRow !== null) {
    return {
      movie: movieSchema.parse(toNowPlayingMovie(nowPlayingRow, parsedCode)),
      isComingSoon: false,
    };
  }
  if (comingSoonRow !== null) {
    return {
      movie: movieSchema.parse(toComingSoonMovie(comingSoonRow, parsedCode)),
      isComingSoon: true,
    };
  }
  return null;
}
