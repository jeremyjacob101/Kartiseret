import { getSupabaseBrowserClient } from "../lib/supabase";

type TheaterRow = {
  city: string | null;
  chain: string | null;
  address: string | null;
  location: string;
  city_alt_spellings: string[] | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  zoom_layer: number | string | null;
};

export type Theater = {
  city: string;
  chain: string;
  address: string;
  cityAltSpellings: string[];
  location: string;
  lat: number | null;
  lng: number | null;
  zoomLayer: number | null;
};

const THEATERS_TABLE_NAME = "theaters";
const THEATER_SELECT_COLUMNS = [
  "city",
  "chain",
  "address",
  "location",
  "city_alt_spellings",
  "latitude",
  "longitude",
  "zoom_layer",
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
  const normalizeValues = (values: readonly string[]) =>
    [...new Set(values.map(normalizeText).filter(Boolean))];

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

function mapRowToTheater(row: TheaterRow): Theater {
  const location = normalizeText(row.location);
  const city = normalizeText(row.city);
  const cityAltSpellings = normalizeStringArray(row.city_alt_spellings);

  if (city && !cityAltSpellings.includes(city)) {
    cityAltSpellings.unshift(city);
  }

  return {
    city,
    chain: normalizeText(row.chain),
    address: normalizeText(row.address),
    cityAltSpellings,
    location,
    lat: normalizeOptionalNumber(row.latitude),
    lng: normalizeOptionalNumber(row.longitude),
    zoomLayer: normalizeOptionalNumber(row.zoom_layer),
  };
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
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from(THEATERS_TABLE_NAME)
        .select(THEATER_SELECT_COLUMNS);

      if (error) {
        throw error;
      }

      const nextTheaters = ((data ?? []) as unknown as TheaterRow[])
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
