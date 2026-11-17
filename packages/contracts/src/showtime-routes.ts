import { ALL_LOCATIONS, type AppLocation } from "./preferences.js";

function slugifyCity(city: string): string {
  const normalized = city.normalize("NFKD").toLocaleLowerCase("en");
  let slug = "";
  let separatorPending = false;

  for (const character of normalized) {
    const isAsciiLetter = character >= "a" && character <= "z";
    const isAsciiDigit = character >= "0" && character <= "9";

    if (isAsciiLetter || isAsciiDigit) {
      if (separatorPending && slug.length > 0) slug += "-";
      slug += character;
      separatorPending = false;
    } else if (slug.length > 0) {
      separatorPending = true;
    }
  }

  return slug;
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
