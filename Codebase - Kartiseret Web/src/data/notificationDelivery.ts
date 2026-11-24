import { notificationDeliverySchema, preferencesResponseSchema, pushDeviceStatusResponseSchema, type NotificationDelivery } from "@kartiseret/contracts/private-data";
import { mutationOptions, queryOptions, skipToken } from "@tanstack/react-query";
import { applicationIdentitySchema } from "@kartiseret/contracts/private-data";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import { privateApiResponse } from "./privateApi";
import { queryClient } from "../lib/queryClient";

const userIdSchema = applicationIdentitySchema.shape.id;

export const notificationDeliveryQueryKeys = {
  preference: (userId: string | null) =>
    ["notificationDelivery", userId] as const,
  device: (userId: string | null) => ["pushDevice", userId] as const,
};

export function notificationDeliveryQueryOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "notification preference user ID")
    : null;
  return queryOptions({
    queryKey: notificationDeliveryQueryKeys.preference(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/preferences",
            preferencesResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.notificationDelivery;
        }
      : skipToken,
    staleTime: 60_000,
  });
}

export function pushDeviceStatusQueryOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "push device user ID")
    : null;
  return queryOptions({
    queryKey: notificationDeliveryQueryKeys.device(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/push/devices/status",
            pushDeviceStatusResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.registered;
        }
      : skipToken,
    staleTime: 60_000,
  });
}

export function notificationDeliveryMutationOptions(userId: string | null) {
  const normalizedUserId = userId
    ? parseBoundary(userIdSchema, userId, "notification preference user ID")
    : null;
  return mutationOptions({
    mutationKey: ["notificationDelivery", "change", normalizedUserId],
    retry: false,
    mutationFn: async (delivery: NotificationDelivery) => {
      if (!normalizedUserId) throw new Error("Log in to update this setting.");
      const selected = parseBoundary(
        notificationDeliverySchema,
        delivery,
        "notification delivery preference",
      );
      const response = await privateApiResponse(
        "/api/v1/preferences",
        preferencesResponseSchema,
        {
          method: "PATCH",
          userId: normalizedUserId,
          body: { notificationDelivery: selected },
        },
      );
      return response.data.notificationDelivery;
    },
    onSuccess: (delivery) => {
      queryClient.setQueryData(
        notificationDeliveryQueryKeys.preference(normalizedUserId),
        delivery,
      );
    },
  });
}
