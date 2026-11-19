import { homepageAdminDataResponseSchema, homepageFeaturedResponseSchema, homepageMovieHighlightResponseSchema, homepageMovieIdSchema, homepagePromotionResponseSchema, homepagePromotionUpsertSchema, homepageRemovedResponseSchema, type HomepageMovieHighlight, type HomepagePromotion, type HomepagePromotionUpsert } from "@kartiseret/contracts/homepage-featured";
import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { privateApiResponse } from "./privateApi";
import { getApiResponse } from "./apiClient";

const staleTime = 30_000;

export const homepageFeaturedQueryKey = ["homepageFeatured"] as const;
export const homepageAdminQueryKey = (userId: string | null) =>
  ["homepageFeatured", "admin", userId] as const;

export function homepageFeaturedQueryOptions() {
  return queryOptions({
    queryKey: homepageFeaturedQueryKey,
    queryFn: ({ signal }) =>
      getApiResponse(
        "/api/v1/homepage/featured",
        homepageFeaturedResponseSchema,
        signal,
      ),
    staleTime,
  });
}

export function homepageAdminQueryOptions(userId: string | null) {
  return queryOptions({
    queryKey: homepageAdminQueryKey(userId),
    queryFn: userId
      ? ({ signal }) =>
          privateApiResponse(
            "/api/v1/admin/homepage-featured",
            homepageAdminDataResponseSchema,
            { userId, signal },
          )
      : skipToken,
    staleTime,
  });
}

export const homepageHighlightMutationOptions = (
  userId: string,
  client: QueryClient,
) =>
  mutationOptions({
    mutationFn: (highlight: HomepageMovieHighlight) =>
      privateApiResponse(
        "/api/v1/admin/homepage-highlights",
        homepageMovieHighlightResponseSchema,
        {
          method: "POST",
          body: highlight,
          userId,
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: homepageFeaturedQueryKey }),
        client.invalidateQueries({ queryKey: homepageAdminQueryKey(userId) }),
      ]);
    },
  });

export const removeHomepageHighlightMutationOptions = (
  userId: string,
  client: QueryClient,
) =>
  mutationOptions({
    mutationFn: (tmdbId: string) =>
      privateApiResponse(
        `/api/v1/admin/homepage-highlights/${homepageMovieIdSchema.parse(tmdbId)}`,
        homepageRemovedResponseSchema,
        { method: "DELETE", userId },
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: homepageFeaturedQueryKey }),
        client.invalidateQueries({ queryKey: homepageAdminQueryKey(userId) }),
      ]);
    },
  });

export const homepagePromotionMutationOptions = (
  userId: string,
  client: QueryClient,
) =>
  mutationOptions({
    mutationFn: (promotion: HomepagePromotionUpsert) =>
      privateApiResponse(
        "/api/v1/admin/homepage-promotions",
        homepagePromotionResponseSchema,
        {
          method: "POST",
          body: homepagePromotionUpsertSchema.parse(promotion),
          userId,
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: homepageFeaturedQueryKey }),
        client.invalidateQueries({ queryKey: homepageAdminQueryKey(userId) }),
      ]);
    },
  });

export type {
  HomepageMovieHighlight,
  HomepagePromotion,
  HomepagePromotionUpsert,
};
