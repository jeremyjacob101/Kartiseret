import { movieCodeSchema } from "@kartiseret/contracts/runtime";
import { PASSWORD_RESET_PATH } from "../lib/authRoutes.js";

const FIXED_APP_PATHS = new Set([
  "/",
  "/movies",
  "/showtimes",
  "/cinematheques",
  "/soons",
  "/user",
  "/attribution",
  PASSWORD_RESET_PATH,
]);

function isPotentialStandaloneMoviePath(pathname: string): boolean {
  if (FIXED_APP_PATHS.has(pathname)) return false;
  const segment = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return (
    !segment.includes("/") &&
    movieCodeSchema.safeParse(segment.slice(0, 3)).success
  );
}

export async function preloadPublicRouteModules(
  pathname: string,
): Promise<void> {
  const loaders: Array<Promise<unknown>> = [];
  if (pathname === "/movies" || pathname === "/soons") {
    loaders.push(import("../components/PosterGridPage.js"));
  }
  if (pathname === "/showtimes") {
    loaders.push(import("../components/AllShowtimesPage.js"));
  }
  if (pathname === "/cinematheques") {
    loaders.push(import("../components/CinemathequesPage.js"));
  }
  if (pathname.startsWith("/c/")) {
    loaders.push(import("../components/CinemaPage.js"));
  }
  if (isPotentialStandaloneMoviePath(pathname)) {
    loaders.push(import("../components/MoviePage.js"));
  }
  await Promise.all(loaders);
}
