import { loadAllShowtimesPageModule, loadCinemaPageModule, loadCinemathequesPageModule, loadMoviePageModule, loadPosterGridPageModule, loadUserPreferencesPageModule } from "./publicRouteModuleLoaders.js";
import type { PublicRouteComponents } from "./PublicRouteComponentsContext.js";
import { movieCodeSchema } from "@kartiseret/contracts/runtime";
import { siteInformationPages } from "./siteInformation.js";
import { PASSWORD_RESET_PATH } from "../lib/authRoutes.js";

const FIXED_APP_PATHS = new Set([
  "/",
  "/movies",
  "/showtimes",
  "/cinematheques",
  "/soons",
  "/user",
  ...siteInformationPages.map(({ path }) => path),
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
): Promise<PublicRouteComponents> {
  const loaders: Array<Promise<unknown>> = [];
  const components: PublicRouteComponents = {};
  if (pathname === "/movies" || pathname === "/soons") {
    loaders.push(loadPosterGridPageModule());
  }
  if (pathname === "/user") {
    loaders.push(loadUserPreferencesPageModule());
  }
  if (pathname === "/showtimes" || pathname.startsWith("/showtimes/")) {
    loaders.push(
      loadAllShowtimesPageModule().then(({ AllShowtimesPage }) => {
        components.allShowtimesPage = AllShowtimesPage;
      }),
    );
  }
  if (pathname === "/cinematheques") {
    loaders.push(loadCinemathequesPageModule());
  }
  if (pathname.startsWith("/c/")) {
    loaders.push(
      loadCinemaPageModule().then(({ CinemaPage }) => {
        components.cinemaPage = CinemaPage;
      }),
    );
  }
  if (isPotentialStandaloneMoviePath(pathname)) {
    loaders.push(loadMoviePageModule());
  }
  await Promise.all(loaders);
  return components;
}
