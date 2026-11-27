import {
  buildMovieShowtimeSharePath,
  movieShowtimeShareStateSchema,
} from "./showtime-links.js";
import { getShowtimesCityPath } from "./showtime-routes.js";
import { getCinemaDayDate } from "./showtime-day.js";
import { z } from "zod";

export const PUBLIC_ROUTE_CODE_LENGTH = 8;
export const PUBLIC_ROUTE_ALPHABET_SIZE = 36;
export const PUBLIC_ROUTE_CODE_CAPACITY =
  PUBLIC_ROUTE_ALPHABET_SIZE ** PUBLIC_ROUTE_CODE_LENGTH;
const SECURE_EMAIL_ACTION_PATH =
  /^\/(?:e[A-Za-z0-9._-]{24,4094}|[rd][A-Za-z0-9_-]{16,256}|u[A-Za-z0-9_-]{43})$/;

export function isSecureEmailActionPath(pathname: string): boolean {
  return SECURE_EMAIL_ACTION_PATH.test(pathname);
}

const fixedPublicPaths = new Set([
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
const publicAccountTabs = new Set([
  "showtimes",
  "discovery",
  "appearance",
  "notifications",
  "account",
]);

function isSafePageDestination(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value, "https://seret.site");
  } catch {
    return false;
  }
  if (url.origin !== "https://seret.site" || url.hash) return false;
  if (fixedPublicPaths.has(url.pathname) && url.pathname !== "/") {
    return url.searchParams.size === 0;
  }
  if (url.pathname !== "/" && url.pathname !== "/user") return false;

  const allowedKeys =
    url.pathname === "/user"
      ? new Set(["tab", "linked", "linkError", "error"])
      : new Set(["verified", "accountDeleted", "authError", "error"]);
  return [...url.searchParams].every(([key, item]) => {
    if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) {
      return false;
    }
    if (key === "tab") return publicAccountTabs.has(item);
    return key === "error" ? /^[A-Za-z0-9_-]{1,64}$/.test(item) : item === "1";
  });
}

export const publicRouteKindSchema = z.enum([
  "page",
  "movie",
  "cinema",
  "city",
  "share",
]);

export const publicRouteSchema = z.object({
  code: z.string().regex(/^[a-z0-9]{8}$/),
  destinationKey: z.string().min(1).max(240),
  kind: publicRouteKindSchema,
  destinationId: z.string().min(1).max(240),
  payload: z.record(z.string(), z.unknown()),
});

export type PublicRoute = z.infer<typeof publicRouteSchema>;

export function getPublicRouteRenderPath(route: PublicRoute): string | null {
  switch (route.kind) {
    case "page": {
      return isSafePageDestination(route.destinationId)
        ? route.destinationId
        : null;
    }
    case "movie":
      return /^[0-9A-Za-z]{3}$/.test(route.destinationId)
        ? `/${encodeURIComponent(route.destinationId)}`
        : null;
    case "cinema":
      return /^[A-Za-z0-9_-]{12}$/.test(route.destinationId)
        ? `/__cinema/${encodeURIComponent(route.destinationId)}`
        : null;
    case "city":
      return getShowtimesCityPath(route.destinationId);
    case "share": {
      const parsed = movieShowtimeShareStateSchema.safeParse(route.payload);
      if (!parsed.success) return null;
      const today = getCinemaDayDate(new Date());
      const state =
        parsed.data.date < today
          ? { ...parsed.data, date: today }
          : parsed.data;
      return buildMovieShowtimeSharePath(state);
    }
  }
}
