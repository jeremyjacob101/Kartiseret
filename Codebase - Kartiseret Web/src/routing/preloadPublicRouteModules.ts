import { loadAllShowtimesPageModule, loadCinemaPageModule, loadCinemathequesPageModule, loadMoviePageModule, loadPosterGridPageModule, loadUserPreferencesPageModule } from "./publicRouteModuleLoaders.js";
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
  "/unsubscribe/letterboxd",
  PASSWORD_RESET_PATH,
  "/confirm-account-deletion",
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
    loaders.push(loadPosterGridPageModule());
  }
  if (pathname === "/user") {
    loaders.push(loadUserPreferencesPageModule());
  }
  if (pathname === "/showtimes" || pathname.startsWith("/showtimes/")) {
    loaders.push(loadAllShowtimesPageModule());
  }
  if (pathname === "/cinematheques") {
    loaders.push(loadCinemathequesPageModule());
  }
  if (pathname.startsWith("/c/")) {
    loaders.push(loadCinemaPageModule());
  }
  if (isPotentialStandaloneMoviePath(pathname)) {
    loaders.push(loadMoviePageModule());
  }
  await Promise.all(loaders);
}
