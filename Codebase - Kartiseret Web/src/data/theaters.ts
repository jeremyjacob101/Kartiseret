import { getSupabaseBrowserClient } from "../lib/supabase";

type TheaterRow = {
  city?: string | null;
  chain: string | null;
  address: string | null;
  location: string;
  theater_name: string | null;
  city_alt_spellings?: string[] | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  zoom_layer?: number | string | null;
  city_details?: CityRow | CityRow[] | null;
};

type CityRow = {
  slug?: string | null;
  name?: string | null;
  alt_spellings?: string[] | string | null;
  zoom_layer?: number | string | null;
};

export type Theater = {
  city: string;
  chain: string;
  address: string;
  theaterName: string;
  cityAltSpellings: string[];
  location: string;
  lat: number | null;
  lng: number | null;
  zoomLayer: number | null;
};

const THEATERS_TABLE_NAME = "theaters";
const BASE_THEATER_SELECT_COLUMNS = [
  "chain",
  "address",
  "location",
  "theater_name",
  "latitude",
  "longitude",
].join(", ");
const LEGACY_THEATER_SELECT_COLUMNS = [
  BASE_THEATER_SELECT_COLUMNS,
  "city",
  "city_alt_spellings",
  "zoom_layer",
].join(", ");
const CITY_JOIN_THEATER_SELECT_COLUMNS = [
  BASE_THEATER_SELECT_COLUMNS,
  "city_details:cities!theaters_city_slug_fkey ( slug, name, alt_spellings, zoom_layer )",
].join(", ");

let cachedTheaters: Theater[] | null = null;
let loadTheatersPromise: Promise<Theater[]> | null = null;

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function compareTheaters(left: Theater, right: Theater): number {
  const cityComparison = left.city.localeCompare(right.city);

  if (cityComparison !== 0) {
    return cityComparison;
  }

  const chainComparison = left.chain.localeCompare(right.chain);

  if (chainComparison !== 0) {
    return chainComparison;
  }

  return left.address.localeCompare(right.address);
}

function normalizeOptionalNumber(
  value: number | string | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStringArray(
  value: string[] | string | null | undefined,
): string[] {
  const normalizeValues = (values: readonly string[]) => [
    ...new Set(values.map(normalizeText).filter(Boolean)),
  ];

  if (Array.isArray(value)) {
    return normalizeValues(value);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedValue) as unknown;

    if (Array.isArray(parsed)) {
      return normalizeValues(
        parsed.filter((entry): entry is string => typeof entry === "string"),
      );
    }
  } catch {
    // Fall through to a permissive text split.
  }

  return normalizeValues(
    trimmedValue
      .replace(/^[{[]|[}\]]$/g, "")
      .split(",")
      .map((entry) => entry.replace(/^"+|"+$/g, "")),
  );
}

function getJoinedCity(row: TheaterRow): CityRow | null {
  if (Array.isArray(row.city_details)) {
    return row.city_details[0] ?? null;
  }

  return row.city_details ?? null;
}

function mapRowToTheater(row: TheaterRow): Theater {
  const location = normalizeText(row.location);
  const joinedCity = getJoinedCity(row);
  const city = normalizeText(joinedCity?.name ?? row.city);
  const cityAltSpellings = normalizeStringArray(
    joinedCity?.alt_spellings ?? row.city_alt_spellings,
  );

  if (city && !cityAltSpellings.includes(city)) {
    cityAltSpellings.unshift(city);
  }

  return {
    city,
    chain: normalizeText(row.chain),
    address: normalizeText(row.address),
    theaterName: normalizeText(row.theater_name),
    cityAltSpellings,
    location,
    lat: normalizeOptionalNumber(row.latitude),
    lng: normalizeOptionalNumber(row.longitude),
    zoomLayer: normalizeOptionalNumber(joinedCity?.zoom_layer ?? row.zoom_layer),
  };
}

function shouldFallbackToLegacyTheatersQuery(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const details =
    "details" in error && typeof error.details === "string" ? error.details : "";
  const hint = "hint" in error && typeof error.hint === "string" ? error.hint : "";
  const combinedText = `${message}\n${details}\n${hint}`.toLowerCase();

  return (
    combinedText.includes("cities") ||
    combinedText.includes("theaters_city_slug_fkey") ||
    combinedText.includes("city_slug")
  );
}

async function fetchTheaterRows(): Promise<TheaterRow[]> {
  const supabase = getSupabaseBrowserClient();
  const preferredResult = await supabase
    .from(THEATERS_TABLE_NAME)
    .select(CITY_JOIN_THEATER_SELECT_COLUMNS);

  if (!preferredResult.error) {
    return (preferredResult.data ?? []) as unknown as TheaterRow[];
  }

  if (!shouldFallbackToLegacyTheatersQuery(preferredResult.error)) {
    throw preferredResult.error;
  }

  console.warn(
    "Falling back to legacy theater city fields because the normalized cities schema is not available yet.",
    preferredResult.error,
  );

  const legacyResult = await supabase
    .from(THEATERS_TABLE_NAME)
    .select(LEGACY_THEATER_SELECT_COLUMNS);

  if (legacyResult.error) {
    throw legacyResult.error;
  }

  return (legacyResult.data ?? []) as unknown as TheaterRow[];
}

export function preloadTheaters(): void {
  void loadTheaters().catch((error: unknown) => {
    console.error("Could not preload theaters from Supabase.", error);
  });
}

export async function loadTheaters(): Promise<Theater[]> {
  if (cachedTheaters) {
    return cachedTheaters;
  }

  if (loadTheatersPromise) {
    return loadTheatersPromise;
  }

  loadTheatersPromise = (async () => {
    try {
      const nextTheaters = (await fetchTheaterRows())
        .map(mapRowToTheater)
        .sort(compareTheaters);

      cachedTheaters = nextTheaters;

      return nextTheaters;
    } finally {
      loadTheatersPromise = null;
    }
  })();

  return loadTheatersPromise;
}
