import { publicTheaterResponseSchema } from "@kartiseret/contracts/public-data";
import type { City, Theater } from "@kartiseret/contracts/movies";
import { queryOptions } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient.js";
import { getApiResponse } from "./apiClient";

export type { City, Theater } from "@kartiseret/contracts/movies";

export type TheaterData = {
  theaters: Theater[];
  cities: City[];
};

const THEATER_DATA_STALE_TIME = 24 * 60 * 60 * 1000;

export const theaterQueryKeys = {
  all: ["theaters"] as const,
};

async function fetchTheaterData(signal?: AbortSignal): Promise<TheaterData> {
  const response = await getApiResponse(
    "/api/v1/theaters",
    publicTheaterResponseSchema,
    signal,
  );
  return response.data;
}

export function theaterDataQueryOptions() {
  return queryOptions({
    queryKey: theaterQueryKeys.all,
    queryFn: ({ signal }) => fetchTheaterData(signal),
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
    console.error("Could not preload theater data from the API.", error);
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
