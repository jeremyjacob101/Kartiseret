import { ALL_LOCATIONS, type AppLocation } from "./preferences.js";

function slugifyCity(city: string): string {
  return city
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const cityBySlug = new Map<string, AppLocation>(
  ALL_LOCATIONS.map((city) => [slugifyCity(city), city]),
);

export function getShowtimesCitySlug(city: string): string {
  return slugifyCity(city);
}

export function getShowtimesCityBySlug(slug: string): AppLocation | null {
  return cityBySlug.get(slug.trim().toLocaleLowerCase("en")) ?? null;
}

export function getShowtimesCityFromPath(pathname: string): AppLocation | null {
  const match = /^\/showtimes\/([^/]+)\/?$/.exec(pathname);
  return match ? getShowtimesCityBySlug(match[1]!) : null;
}

export function getShowtimesCityPath(city: string): string {
  return `/showtimes/${getShowtimesCitySlug(city)}`;
}
