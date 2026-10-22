import { applicationIdentitySchema, comingSoonDateWatchChangeSchema, comingSoonDateWatchCreateSchema, comingSoonDateWatchListResponseSchema, type ComingSoonDateWatch } from "@kartiseret/contracts/private-data";
import { apiSuccessResponseSchema, tmdbTitleSearchResponseSchema, type TmdbTitleSearchResult } from "@kartiseret/contracts/public-data";
import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { getApiResponse, ApiRequestError } from "./apiClient";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import { privateApiResponse } from "./privateApi";
import { queryClient } from "../lib/queryClient";
import { z } from "zod";

const userIdSchema = applicationIdentitySchema.shape.id;
const staleTime = 60 * 1000;
const unwatchResponseSchema = apiSuccessResponseSchema(
  z.object({ removed: z.literal(true) }),
);

export type { ComingSoonDateWatch, TmdbTitleSearchResult };
export type NewComingSoonDateWatch = {
  tmdbId: string;
  title: string;
  releaseYear: number | null;
  posterPath: string | null;
};

export const comingSoonDateWatchQueryKeys = {
  all: ["comingSoonDateWatches"] as const,
  titles: (userId: string | null) =>
    ["comingSoonDateWatches", "titles", userId] as const,
  search: (query: string) =>
    ["comingSoonDateWatches", "search", query] as const,
};

export function tmdbTitleSearchQueryOptions(query: string) {
  const normalized = query.trim();
  return queryOptions({
    queryKey: comingSoonDateWatchQueryKeys.search(normalized),
    queryFn:
      normalized.length >= 2
        ? ({ signal }) => {
            const params = new URLSearchParams({ query: normalized });
            return getApiResponse(
              `/api/v1/tmdb/search?${params.toString()}`,
              tmdbTitleSearchResponseSchema,
              signal,
            ).then((response) => response.data.titles);
          }
        : skipToken,
    retry: (count, error) =>
      !(error instanceof ApiRequestError && error.status === 400) && count < 1,
    staleTime: 2 * staleTime,
    gcTime: 5 * staleTime,
  });
}

export function comingSoonDateWatchesQueryOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Coming Soon date watch user ID")
    : null;
  return queryOptions({
    queryKey: comingSoonDateWatchQueryKeys.titles(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/coming-soon-watches",
            comingSoonDateWatchListResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.watches;
        }
      : skipToken,
    staleTime,
    gcTime: 5 * staleTime,
  });
}

export function comingSoonDateWatchMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Coming Soon date watch user ID")
    : null;
  return mutationOptions({
    mutationKey: ["comingSoonDateWatches", "watch", normalizedUserId],
    retry: false,
    mutationFn: async (value: NewComingSoonDateWatch) => {
      if (!normalizedUserId)
        throw new Error("Log in to watch a Coming Soon date.");
      const input = parseBoundary(
        comingSoonDateWatchCreateSchema,
        value,
        "Coming Soon date watch input",
      );
      const response = await privateApiResponse(
        "/api/v1/coming-soon-watches",
        comingSoonDateWatchChangeSchema,
        { method: "POST", userId: normalizedUserId, body: input },
      );
      return response.data;
    },
    onSuccess: async () => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: comingSoonDateWatchQueryKeys.titles(normalizedUserId),
        exact: true,
      });
    },
  });
}

export function comingSoonDateUnwatchMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Coming Soon date watch user ID")
    : null;
  return mutationOptions({
    mutationKey: ["comingSoonDateWatches", "unwatch", normalizedUserId],
    retry: false,
    mutationFn: async (tmdbId: string) => {
      if (!normalizedUserId)
        throw new Error("Log in to manage Coming Soon date watches.");
      if (!/^\d+$/.test(tmdbId) || !/[1-9]/.test(tmdbId))
        throw new Error("This title ID is invalid.");
      await privateApiResponse(
        `/api/v1/coming-soon-watches/${BigInt(tmdbId).toString()}`,
        unwatchResponseSchema,
        { method: "DELETE", userId: normalizedUserId },
      );
      return BigInt(tmdbId).toString();
    },
    onSuccess: async () => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: comingSoonDateWatchQueryKeys.titles(normalizedUserId),
        exact: true,
      });
    },
  });
}
