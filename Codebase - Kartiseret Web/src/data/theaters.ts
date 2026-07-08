import { getSupabaseBrowserClient } from "../lib/supabase";

type TheaterRow = {
  chain: string;
  address: string;
  location: string;
  theater_name: string;
  latitude: number;
  longitude: number;
  city_details: CityRow;
};

type CityRow = {
  name: string;
  alt_spellings: string[];
  latitude: number;
  longitude: number;
  zoom_layer: number;
  neighboring_cities: string[];
};

export type City = {
  name: string;
  altSpellings: string[];
  latitude: number;
  longitude: number;
  zoomLayer: number;
  neighboringCities: string[];
};

export type Theater = {
  city: City;
  chain: string;
  address: string;
  theaterName: string;
  location: string;
  lat: number;
  lng: number;
};

const THEATERS_TABLE_NAME = "theaters";
const CITY_NAME_JOIN_THEATER_SELECT_COLUMNS = [
  "chain",
  "address",
  "location",
  "theater_name",
  "latitude",
  "longitude",
  "city_details:cities!theaters_city_name_fkey ( name, alt_spellings, latitude, longitude, zoom_layer, neighboring_cities )",
].join(", ");

let cachedTheaters: Theater[] | null = null;
let cachedCities: City[] | null = null;
let loadTheatersPromise: Promise<Theater[]> | null = null;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function compareCities(left: City, right: City): number {
  return left.name.localeCompare(right.name);
}

function compareTheaters(left: Theater, right: Theater): number {
  const cityComparison = left.city.name.localeCompare(right.city.name);

  if (cityComparison !== 0) {
    return cityComparison;
  }

  const chainComparison = left.chain.localeCompare(right.chain);

  if (chainComparison !== 0) {
    return chainComparison;
  }

  return left.address.localeCompare(right.address);
}

function mapRowToTheater(row: TheaterRow): Theater {
  const cityName = normalizeText(row.city_details.name);
  const cityAltSpellings = [
    ...new Set(
      row.city_details.alt_spellings.map(normalizeText).filter(Boolean),
    ),
  ];
  const neighboringCities = [
    ...new Set(
      row.city_details.neighboring_cities
        .map(normalizeText)
        .filter((value) => value && value !== cityName),
    ),
  ];

  if (!cityAltSpellings.includes(cityName)) {
    cityAltSpellings.unshift(cityName);
  }

  return {
    city: {
      name: cityName,
      altSpellings: cityAltSpellings,
      latitude: row.city_details.latitude,
      longitude: row.city_details.longitude,
      zoomLayer: row.city_details.zoom_layer,
      neighboringCities,
    },
    chain: normalizeText(row.chain),
    address: normalizeText(row.address),
    theaterName: normalizeText(row.theater_name),
    location: normalizeText(row.location),
    lat: row.latitude,
    lng: row.longitude,
  };
}

async function fetchTheaterRows(): Promise<TheaterRow[]> {
  const supabase = getSupabaseBrowserClient();
  const result = await supabase
    .from(THEATERS_TABLE_NAME)
    .select(CITY_NAME_JOIN_THEATER_SELECT_COLUMNS);

  if (result.error) {
    throw result.error;
  }

  return result.data as unknown as TheaterRow[];
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

export async function loadCities(): Promise<City[]> {
  if (cachedCities) {
    return cachedCities;
  }

  const theaters = await loadTheaters();
  const cityByName = new Map<string, City>();

  for (const theater of theaters) {
    if (!cityByName.has(theater.city.name)) {
      cityByName.set(theater.city.name, theater.city);
    }
  }

  cachedCities = [...cityByName.values()].sort(compareCities);

  return cachedCities;
}
