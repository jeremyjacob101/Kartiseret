import { queryOptions } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { queryClient } from "../lib/queryClient";

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

export type TheaterData = {
  theaters: Theater[];
  cities: City[];
};

const THEATER_DATA_STALE_TIME = 24 * 60 * 60 * 1000;

export const theaterQueryKeys = {
  all: ["theaters"] as const,
};

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

async function fetchTheaterData(): Promise<TheaterData> {
  const theaters = (await fetchTheaterRows())
    .map(mapRowToTheater)
    .sort(compareTheaters);
  const cityByName = new Map<string, City>();

  for (const theater of theaters) {
    if (!cityByName.has(theater.city.name)) {
      cityByName.set(theater.city.name, theater.city);
    }
  }

  return {
    theaters,
    cities: [...cityByName.values()].sort(compareCities),
  };
}

export function theaterDataQueryOptions() {
  return queryOptions({
    queryKey: theaterQueryKeys.all,
    queryFn: fetchTheaterData,
    staleTime: THEATER_DATA_STALE_TIME,
    gcTime: THEATER_DATA_STALE_TIME,
  });
}

export function selectTheaters(data: TheaterData): Theater[] {
  return data.theaters;
}

export function selectCities(data: TheaterData): City[] {
  return data.cities;
}

export function preloadTheaters(): void {
  void queryClient.prefetchQuery(theaterDataQueryOptions()).catch((
    error: unknown,
  ) => {
    console.error("Could not preload theaters from Supabase.", error);
  });
}

export async function loadTheaters(): Promise<Theater[]> {
  const data = await queryClient.ensureQueryData(theaterDataQueryOptions());
  return data.theaters;
}

export async function loadCities(): Promise<City[]> {
  const data = await queryClient.ensureQueryData(theaterDataQueryOptions());
  return data.cities;
}
