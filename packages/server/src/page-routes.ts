import { createHash, randomInt } from "node:crypto";
import type { Pool } from "pg";
import {
  decodeDateCode,
  movieShowtimeShareStateSchema,
  parseExcludedCinemaIds,
  parseMovieRouteCode,
  resolveCityCode,
} from "@kartiseret/contracts/showtime-links";
import { PUBLIC_ROUTE_CODE_LENGTH } from "@kartiseret/contracts/public-routes";
import { getCinemaDayDate } from "@kartiseret/contracts/showtime-day";
import { getShowtimesCityFromPath } from "@kartiseret/contracts/showtime-routes";

export { PUBLIC_ROUTE_CODE_LENGTH };
export const PUBLIC_ROUTE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_CODE_ALLOCATION_ATTEMPTS = 8;
const ROUTE_CODE_PATTERN = /^[a-z0-9]{8}$/;

export type PublicRouteKind = "page" | "movie" | "cinema" | "city" | "share";

export interface PublicRoute {
  code: string;
  destinationKey: string;
  kind: PublicRouteKind;
  destinationId: string;
  payload: Record<string, unknown>;
}

export interface PublicRouteInput {
  destinationKey: string;
  kind: PublicRouteKind;
  destinationId: string;
  payload?: Record<string, unknown>;
}

const FIXED_PUBLIC_PATHS = new Set([
  "/",
  "/movies",
  "/soons",
  "/showtimes",
  "/cinematheques",
  "/support",
  "/accessibility",
  "/privacy",
  "/terms",
  "/attribution",
  "/third-party-licenses.txt",
  "/reset-password",
]);
const ACCOUNT_TABS = new Set([
  "showtimes",
  "discovery",
  "appearance",
  "notifications",
  "account",
]);
const USER_CALLBACK_KEYS = new Set(["tab", "linked", "linkError", "error"]);
const HOME_CALLBACK_KEYS = new Set([
  "verified",
  "accountDeleted",
  "authError",
  "error",
]);

function canonicalQuery(searchParams: URLSearchParams): string {
  return [...searchParams.entries()]
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

/** Parse supported old browser paths into a stable route registry input. */
export function resolveLegacyPublicRoute(
  rawPath: string,
  instant: Date = new Date(),
): PublicRouteInput | null {
  if (
    rawPath.length > 4_096 ||
    !rawPath.startsWith("/") ||
    rawPath.startsWith("//") ||
    rawPath.includes("#") ||
    Number.isNaN(instant.getTime())
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawPath, "https://seret.site");
  } catch {
    return null;
  }
  if (url.origin !== "https://seret.site") return null;

  const pathname = url.pathname === "/index.html" ? "/" : url.pathname;
  const { searchParams } = url;
  if (FIXED_PUBLIC_PATHS.has(pathname) && searchParams.size === 0) {
    return {
      destinationKey: `page:${pathname}`,
      kind: "page",
      destinationId: pathname,
    };
  }

  if (pathname === "/user") {
    if (searchParams.size === 0) {
      return {
        destinationKey: "page:/user",
        kind: "page",
        destinationId: "/user",
      };
    }
    const allowed = [...searchParams].every(
      ([key, value]) =>
        USER_CALLBACK_KEYS.has(key) &&
        searchParams.getAll(key).length === 1 &&
        (key === "tab"
          ? ACCOUNT_TABS.has(value)
          : key === "error"
            ? /^[A-Za-z0-9_-]{1,64}$/.test(value)
            : value === "1"),
    );
    if (!allowed) return null;
    const query = canonicalQuery(searchParams);
    const tab = searchParams.get("tab");
    return {
      destinationKey:
        tab && searchParams.size === 1
          ? `page:/user:tab:${tab}`
          : `page:/user:query:${query}`,
      kind: "page",
      destinationId: `/user?${query}`,
    };
  }

  if (pathname === "/" && searchParams.size > 0) {
    const allowed = [...searchParams].every(
      ([key, value]) =>
        HOME_CALLBACK_KEYS.has(key) &&
        searchParams.getAll(key).length === 1 &&
        (key === "error" ? /^[A-Za-z0-9_-]{1,64}$/.test(value) : value === "1"),
    );
    if (!allowed) return null;
    const query = canonicalQuery(searchParams);
    return {
      destinationKey: `page:/:query:${query}`,
      kind: "page",
      destinationId: `/?${query}`,
    };
  }

  const city = getShowtimesCityFromPath(pathname);
  if (city && searchParams.size === 0) {
    return {
      destinationKey: `city:${city}`,
      kind: "city",
      destinationId: city,
    };
  }

  const legacyCode = /^\/([0-9A-Za-z]{3,10})$/.exec(pathname)?.[1];
  const parsedRoute = legacyCode ? parseMovieRouteCode(legacyCode) : null;
  if (!legacyCode || !parsedRoute) return null;

  if (parsedRoute.kind === "plain") {
    if (searchParams.size !== 0) return null;
    return {
      destinationKey: `movie-code:${parsedRoute.movieCode}`,
      kind: "movie",
      destinationId: parsedRoute.movieCode,
    };
  }

  for (const key of searchParams.keys()) {
    if (
      (key !== "date" && key !== "excludeCinemas") ||
      searchParams.getAll(key).length !== 1
    ) {
      return null;
    }
  }
  const requestedDate = searchParams.get("date");
  const date = requestedDate
    ? requestedDate
    : decodeDateCode(parsedRoute.dateCode, getCinemaDayDate(instant));
  const cityName = resolveCityCode(parsedRoute.cityCode, "Jerusalem");
  if (!date || !cityName) return null;

  const parsedState = movieShowtimeShareStateSchema.safeParse({
    movieCode: parsedRoute.movieCode,
    city: cityName,
    date,
    filterMask: parsedRoute.filterMask,
    excludedCinemaIds: parseExcludedCinemaIds(url.search),
  });
  if (!parsedState.success) return null;
  const payload = {
    ...parsedState.data,
    excludedCinemaIds: [
      ...new Set(parsedState.data.excludedCinemaIds ?? []),
    ].sort(),
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return {
    destinationKey: `movie-share:${fingerprint}`,
    kind: "share",
    destinationId: payload.movieCode,
    payload,
  };
}

export interface PublicRouteRegistry {
  getByCode(code: string): Promise<PublicRoute | null>;
  getOrCreate(input: PublicRouteInput): Promise<PublicRoute>;
  getOrCreateMany?(inputs: readonly PublicRouteInput[]): Promise<PublicRoute[]>;
}

export function moviePublicRouteInput(movieCode: string): PublicRouteInput {
  return {
    destinationKey: `movie-code:${movieCode}`,
    kind: "movie",
    destinationId: movieCode,
  };
}

/** Attach stable opaque paths to movie records without making links mandatory for catalog reads. */
export async function attachMoviePublicRouteCodes<
  Data extends {
    movies: Array<{ movieCode?: string; publicRouteCode?: string }>;
  },
>(data: Data, registry: PublicRouteRegistry): Promise<Data> {
  const inputs = [
    ...new Set(
      data.movies.flatMap((movie) =>
        movie.movieCode ? [movie.movieCode] : [],
      ),
    ),
  ].map(moviePublicRouteInput);
  if (inputs.length === 0) return data;

  const routes = registry.getOrCreateMany
    ? await registry.getOrCreateMany(inputs)
    : await Promise.all(inputs.map((input) => registry.getOrCreate(input)));
  const byMovieCode = new Map(
    routes.map((route) => [route.destinationId, route.code]),
  );
  return {
    ...data,
    movies: data.movies.map((movie) => ({
      ...movie,
      ...(movie.movieCode && byMovieCode.has(movie.movieCode)
        ? { publicRouteCode: byMovieCode.get(movie.movieCode) }
        : {}),
    })),
  };
}

type RouteRow = {
  code: string;
  destination_key: string;
  destination_type: PublicRouteKind;
  destination_id: string;
  payload: Record<string, unknown>;
};

function createCode(): string {
  let code = "";
  for (let index = 0; index < PUBLIC_ROUTE_CODE_LENGTH; index += 1) {
    code += PUBLIC_ROUTE_ALPHABET[randomInt(PUBLIC_ROUTE_ALPHABET.length)];
  }
  return code;
}

function mapRow(row: RouteRow): PublicRoute {
  return {
    code: row.code,
    destinationKey: row.destination_key,
    kind: row.destination_type,
    destinationId: row.destination_id,
    payload: row.payload,
  };
}

export class PostgresPublicRouteRegistry {
  constructor(
    private readonly pool: Pool,
    private readonly codeFactory: () => string = createCode,
  ) {}

  async getByCode(code: string): Promise<PublicRoute | null> {
    if (!ROUTE_CODE_PATTERN.test(code)) return null;
    const result = await this.pool.query<RouteRow>(
      `SELECT code, destination_key, destination_type, destination_id, payload
       FROM app_auth.public_routes WHERE code = $1`,
      [code],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getOrCreate(input: PublicRouteInput): Promise<PublicRoute> {
    if (!input.destinationKey || !input.destinationId) {
      throw new Error(
        "A public route requires a stable destination key and ID.",
      );
    }

    for (
      let attempt = 0;
      attempt < MAX_CODE_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      const code = this.codeFactory();
      if (!ROUTE_CODE_PATTERN.test(code)) {
        throw new Error(
          "The public route code generator returned an invalid code.",
        );
      }

      try {
        const result = await this.pool.query<RouteRow>(
          `INSERT INTO app_auth.public_routes
             (code, destination_key, destination_type, destination_id, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (destination_key) DO UPDATE SET
             destination_key = EXCLUDED.destination_key
           RETURNING code, destination_key, destination_type, destination_id, payload`,
          [
            code,
            input.destinationKey,
            input.kind,
            input.destinationId,
            JSON.stringify(input.payload ?? {}),
          ],
        );
        const row = result.rows[0];
        if (!row)
          throw new Error(
            "The public route was not returned after allocation.",
          );
        return mapRow(row);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          const existing = await this.pool.query<RouteRow>(
            `SELECT code, destination_key, destination_type, destination_id, payload
             FROM app_auth.public_routes WHERE destination_key = $1`,
            [input.destinationKey],
          );
          if (existing.rows[0]) return mapRow(existing.rows[0]);
          continue;
        }
        throw error;
      }
    }

    throw new Error("Could not allocate a unique public route code.");
  }

  async getOrCreateMany(
    inputs: readonly PublicRouteInput[],
  ): Promise<PublicRoute[]> {
    const uniqueInputs = [
      ...new Map(inputs.map((input) => [input.destinationKey, input])).values(),
    ];
    if (uniqueInputs.length === 0) return [];
    for (const input of uniqueInputs) {
      if (!input.destinationKey || !input.destinationId) {
        throw new Error(
          "A public route requires a stable destination key and ID.",
        );
      }
      if (
        Buffer.byteLength(JSON.stringify(input.payload ?? {}), "utf8") > 8_192
      ) {
        throw new Error("A public route payload exceeds the allowed size.");
      }
    }

    const records = new Map<string, PublicRoute>();
    for (let start = 0; start < uniqueInputs.length; start += 100) {
      const chunk = uniqueInputs.slice(start, start + 100);
      let inserted: RouteRow[] | null = null;
      for (
        let attempt = 0;
        attempt < MAX_CODE_ALLOCATION_ATTEMPTS;
        attempt += 1
      ) {
        const values: unknown[] = [];
        const placeholders = chunk.map((input, index) => {
          const code = this.codeFactory();
          if (!ROUTE_CODE_PATTERN.test(code)) {
            throw new Error(
              "The public route code generator returned an invalid code.",
            );
          }
          const offset = index * 5;
          values.push(
            code,
            input.destinationKey,
            input.kind,
            input.destinationId,
            JSON.stringify(input.payload ?? {}),
          );
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb)`;
        });
        try {
          const result = await this.pool.query<RouteRow>(
            `INSERT INTO app_auth.public_routes
               (code, destination_key, destination_type, destination_id, payload)
             VALUES ${placeholders.join(", ")}
             ON CONFLICT (destination_key) DO UPDATE SET
               destination_key = EXCLUDED.destination_key
             RETURNING code, destination_key, destination_type, destination_id, payload`,
            values,
          );
          inserted = result.rows;
          break;
        } catch (error) {
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            error.code !== "23505"
          ) {
            throw error;
          }
          const existing = await this.pool.query<RouteRow>(
            `SELECT code, destination_key, destination_type, destination_id, payload
             FROM app_auth.public_routes WHERE destination_key = ANY($1::text[])`,
            [chunk.map((input) => input.destinationKey)],
          );
          if (existing.rows.length === chunk.length) {
            inserted = existing.rows;
            break;
          }
        }
      }
      if (!inserted || inserted.length !== chunk.length) {
        throw new Error("Could not allocate unique public route codes.");
      }
      for (const row of inserted) records.set(row.destination_key, mapRow(row));
    }
    return uniqueInputs.map((input) => {
      const route = records.get(input.destinationKey);
      if (!route)
        throw new Error("A public route was not returned after allocation.");
      return route;
    });
  }
}
