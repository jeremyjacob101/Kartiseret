import { currentPublicationRevision, refreshPublicationCollections, tagPublication } from "./publicationRevision.js";
import { publicCinemathequeResponseSchema, type PublicCinemathequeData } from "@kartiseret/contracts/public-data";
import { fixedAppDateString, SHOWTIME_WINDOW_DAY_COUNT } from "./movieCatalog.js";
import { getPublicationResponse, ApiRequestError } from "./apiClient.js";
import { addCalendarDays } from "@kartiseret/contracts/showtime-links";
import type { AppLocation } from "../prefs/definitions/locations.js";
import { queryOptions } from "@tanstack/react-query";

const CINEMATHEQUE_STALE_TIME = 60 * 1000;
const CINEMATHEQUE_GC_TIME = 30 * 60 * 1000;

export type CinemathequeData = PublicCinemathequeData & {
  publicationRevision: string;
};

export const cinemathequeQueryKeys = {
  all: ["cinematheques"] as const,
  data: (
    city: AppLocation | null,
    publicationRevision = currentPublicationRevision(),
    endDate?: string,
    tmdbId?: string,
  ) =>
    [
      "cinematheques",
      {
        city: city ?? "nationwide",
        endDate: endDate ?? "open-ended",
        tmdbId: tmdbId ?? "all-movies",
        ...(publicationRevision === undefined ? {} : { publicationRevision }),
      },
    ] as const,
};

export function getCinemathequeDateRange(startDate = fixedAppDateString) {
  const endDate = addCalendarDays(startDate, SHOWTIME_WINDOW_DAY_COUNT - 1);
  if (endDate === null) {
    throw new Error("The cinematheque date range is invalid.");
  }

  return { startDate, endDate };
}

export function buildCinemathequeDateRange(
  startDate: string,
  endDate: string,
): string[] {
  const dates: string[] = [];
  let currentDate: string | null = startDate;

  while (currentDate !== null && currentDate <= endDate) {
    dates.push(currentDate);
    currentDate = addCalendarDays(currentDate, 1);
  }

  return dates;
}

export function cinemathequeQueryOptions(
  city: AppLocation | null,
  publicationRevision = currentPublicationRevision(),
  endDate?: string,
  tmdbId?: string,
) {
  return queryOptions({
    queryKey: cinemathequeQueryKeys.data(
      city,
      publicationRevision,
      endDate,
      tmdbId,
    ),
    queryFn: async ({ signal }): Promise<CinemathequeData> => {
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      params.set("startDate", fixedAppDateString);
      if (endDate) params.set("endDate", endDate);
      if (tmdbId) params.set("tmdbId", tmdbId);

      try {
        const { response, revision } = await getPublicationResponse(
          `/api/v1/cinematheques?${params.toString()}`,
          publicCinemathequeResponseSchema,
          signal,
          publicationRevision,
        );
        tagPublication(response.data.movies, revision);
        tagPublication(response.data.showtimes, revision);
        return { ...response.data, publicationRevision: revision };
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.code === "publication_changed"
        ) {
          await refreshPublicationCollections();
        }
        throw error;
      }
    },
    retry: (count, error) =>
      !(
        error instanceof ApiRequestError && error.code === "publication_changed"
      ) && count < 1,
    staleTime: CINEMATHEQUE_STALE_TIME,
    gcTime: CINEMATHEQUE_GC_TIME,
  });
}

export function nationwideCinemathequeQueryOptions(
  endDate?: string,
  publicationRevision = currentPublicationRevision(),
  tmdbId?: string,
) {
  return cinemathequeQueryOptions(null, publicationRevision, endDate, tmdbId);
}
