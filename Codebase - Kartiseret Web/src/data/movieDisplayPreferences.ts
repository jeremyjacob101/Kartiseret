import { applicationIdentitySchema, movieDisplayPreferenceChangeSchema, movieDisplayPreferenceCreateSchema, movieDisplayPreferenceListResponseSchema, movieDisplayPreferencePatchSchema, movieDisplayPreferenceRemoveSchema, type MovieDisplayPreference } from "@kartiseret/contracts/private-data";
import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import type { Movie } from "@kartiseret/contracts/movies";
import { privateApiResponse } from "./privateApi";
import { queryClient } from "../lib/queryClient";

const userIdSchema = applicationIdentitySchema.shape.id;
const staleTime = 60 * 1000;

export type { MovieDisplayPreference };

export const movieDisplayPreferenceQueryKeys = {
  all: ["movieDisplayPreferences"] as const,
  list: (userId: string | null) =>
    ["movieDisplayPreferences", "list", userId] as const,
};

export function movieDisplayPreferencesQueryOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "Movie display preference user ID")
    : null;
  return queryOptions({
    queryKey: movieDisplayPreferenceQueryKeys.list(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/preferences/movie-display",
            movieDisplayPreferenceListResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.preferences;
        }
      : skipToken,
    staleTime,
    gcTime: 5 * staleTime,
  });
}

function normalizedMutationUserId(userId: string | null): string | null {
  return userId
    ? parseBoundary(userIdSchema, userId, "Movie display preference user ID")
    : null;
}

function invalidateMovieDisplayPreferences(
  client: QueryClient,
  userId: string | null,
) {
  if (!userId) return;
  return client.invalidateQueries({
    queryKey: movieDisplayPreferenceQueryKeys.list(userId),
    exact: true,
  });
}

export function addMovieDisplayPreferenceMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizedMutationUserId(userId);
  return mutationOptions({
    mutationKey: ["movieDisplayPreferences", "add", normalizedUserId],
    retry: false,
    mutationFn: async (value: MovieDisplayPreference) => {
      if (!normalizedUserId)
        throw new Error("Log in to save movie display preferences.");
      const input = parseBoundary(
        movieDisplayPreferenceCreateSchema,
        value,
        "Movie display preference input",
      );
      const response = await privateApiResponse(
        "/api/v1/preferences/movie-display",
        movieDisplayPreferenceChangeSchema,
        { method: "POST", userId: normalizedUserId, body: input },
      );
      return response.data.preference;
    },
    onSuccess: () =>
      invalidateMovieDisplayPreferences(client, normalizedUserId),
  });
}

export function updateMovieDisplayPreferenceMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizedMutationUserId(userId);
  return mutationOptions({
    mutationKey: ["movieDisplayPreferences", "update", normalizedUserId],
    retry: false,
    mutationFn: async (value: {
      tmdbId: string;
      patch: Partial<
        Pick<MovieDisplayPreference, "treatment" | "hideBackdrop">
      >;
    }) => {
      if (!normalizedUserId)
        throw new Error("Log in to save movie display preferences.");
      const tmdbId = parseBoundary(
        movieDisplayPreferenceCreateSchema.shape.tmdbId,
        value.tmdbId,
        "Movie display preference TMDb ID",
      );
      const patch = parseBoundary(
        movieDisplayPreferencePatchSchema,
        value.patch,
        "Movie display preference update",
      );
      const response = await privateApiResponse(
        `/api/v1/preferences/movie-display/${encodeURIComponent(tmdbId)}`,
        movieDisplayPreferenceChangeSchema,
        { method: "PATCH", userId: normalizedUserId, body: patch },
      );
      return response.data.preference;
    },
    onSuccess: () =>
      invalidateMovieDisplayPreferences(client, normalizedUserId),
  });
}

export function removeMovieDisplayPreferenceMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizedMutationUserId(userId);
  return mutationOptions({
    mutationKey: ["movieDisplayPreferences", "remove", normalizedUserId],
    retry: false,
    mutationFn: async (value: string) => {
      if (!normalizedUserId)
        throw new Error("Log in to save movie display preferences.");
      const tmdbId = parseBoundary(
        movieDisplayPreferenceCreateSchema.shape.tmdbId,
        value,
        "Movie display preference TMDb ID",
      );
      await privateApiResponse(
        `/api/v1/preferences/movie-display/${encodeURIComponent(tmdbId)}`,
        movieDisplayPreferenceRemoveSchema,
        { method: "DELETE", userId: normalizedUserId },
      );
      return tmdbId;
    },
    onSuccess: () =>
      invalidateMovieDisplayPreferences(client, normalizedUserId),
  });
}

export type MovieDisplayPreferencesById = ReadonlyMap<
  string,
  MovieDisplayPreference
>;

export function indexMovieDisplayPreferences(
  preferences: readonly MovieDisplayPreference[],
): MovieDisplayPreferencesById {
  return new Map(
    preferences.map((preference) => [preference.tmdbId, preference]),
  );
}

export function applyMovieDisplayPreference(
  movie: Movie,
  preferences: MovieDisplayPreferencesById,
): Movie | null {
  const preference = preferences.get(movie.tmdbId);
  if (!preference) return movie;
  if (preference.treatment === "remove") return null;
  if (!preference.hideBackdrop) return { ...movie, imageSrc: "" };

  const movieWithoutBackdrop = { ...movie };
  delete movieWithoutBackdrop.backdropSrc;
  return { ...movieWithoutBackdrop, imageSrc: "" };
}

export function applyMovieDisplayPreferences(
  movies: readonly Movie[],
  preferences: MovieDisplayPreferencesById,
): Movie[] {
  const visible: Movie[] = [];
  for (const movie of movies) {
    const displayed = applyMovieDisplayPreference(movie, preferences);
    if (displayed) visible.push(displayed);
  }
  return visible;
}
