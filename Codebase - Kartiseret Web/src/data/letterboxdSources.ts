import { applicationIdentitySchema, letterboxdSourceChangeSchema, letterboxdSourceCreateSchema, letterboxdSourceListResponseSchema, letterboxdSourceRemoveResponseSchema, type LetterboxdSource } from "@kartiseret/contracts/private-data";
import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import { privateApiResponse } from "./privateApi";
import { queryClient } from "../lib/queryClient";
import { z } from "zod";

const userIdSchema = applicationIdentitySchema.shape.id;
const removeSourceIdSchema = z.string().uuid();
const staleTime = 60 * 1000;

export type { LetterboxdSource };
export type NewLetterboxdSource = { sourceUrl: string };

export const letterboxdSourceQueryKeys = {
  all: ["letterboxdSources"] as const,
  list: (userId: string | null) =>
    ["letterboxdSources", "list", userId] as const,
};

export function letterboxdSourcesQueryOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Letterboxd source user ID")
    : null;
  return queryOptions({
    queryKey: letterboxdSourceQueryKeys.list(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/letterboxd-sources",
            letterboxdSourceListResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.sources;
        }
      : skipToken,
    staleTime,
    gcTime: 5 * staleTime,
  });
}

export function addLetterboxdSourceMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Letterboxd source user ID")
    : null;
  return mutationOptions({
    mutationKey: ["letterboxdSources", "add", normalizedUserId],
    retry: false,
    mutationFn: async (value: NewLetterboxdSource) => {
      if (!normalizedUserId)
        throw new Error("Log in to track a Letterboxd source.");
      const input = parseBoundary(
        letterboxdSourceCreateSchema,
        value,
        "Letterboxd source input",
      );
      const response = await privateApiResponse(
        "/api/v1/letterboxd-sources",
        letterboxdSourceChangeSchema,
        { method: "POST", userId: normalizedUserId, body: input },
      );
      return response.data.source;
    },
    onSuccess: async () => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: letterboxdSourceQueryKeys.list(normalizedUserId),
        exact: true,
      });
    },
  });
}

export function removeLetterboxdSourceMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Letterboxd source user ID")
    : null;
  return mutationOptions({
    mutationKey: ["letterboxdSources", "remove", normalizedUserId],
    retry: false,
    mutationFn: async (sourceId: string) => {
      if (!normalizedUserId)
        throw new Error("Log in to manage Letterboxd sources.");
      const normalizedSourceId = parseBoundary(
        removeSourceIdSchema,
        sourceId,
        "Letterboxd source ID",
      );
      const response = await privateApiResponse(
        `/api/v1/letterboxd-sources/${normalizedSourceId}`,
        letterboxdSourceRemoveResponseSchema,
        { method: "DELETE", userId: normalizedUserId },
      );
      return response.data.removed;
    },
    onSuccess: async () => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: letterboxdSourceQueryKeys.list(normalizedUserId),
        exact: true,
      });
    },
  });
}
