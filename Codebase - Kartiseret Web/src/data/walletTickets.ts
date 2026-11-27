import { applicationIdentitySchema, walletTicketChangeResponseSchema, walletTicketCreateSchema, walletTicketDetailResponseSchema, walletTicketIdSchema, walletTicketListResponseSchema, walletTicketPatchSchema, walletTicketRecentClickCreateSchema, walletTicketRecentClickResponseSchema, walletTicketRemoveResponseSchema, type WalletTicket, type WalletTicketCreate, type WalletTicketPatch, type WalletTicketRecentClick } from "@kartiseret/contracts/private-data";
import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import { privateApiResponse } from "./privateApi";
import { queryClient } from "../lib/queryClient";

const userIdSchema = applicationIdentitySchema.shape.id;
const staleTime = 30 * 1000;

export type { WalletTicket, WalletTicketCreate, WalletTicketPatch };

export const walletTicketQueryKeys = {
  all: ["walletTickets"] as const,
  list: (userId: string | null) => ["walletTickets", "list", userId] as const,
  detail: (userId: string | null, ticketId: string | null) =>
    ["walletTickets", "detail", userId, ticketId] as const,
  recentScreening: (userId: string | null) =>
    ["walletTickets", "recentScreening", userId] as const,
};

function normalizeUserId(userId: string | null): string | null {
  return userId
    ? parseBoundary(userIdSchema, userId, "Ticket owner user ID")
    : null;
}

export function walletTicketsQueryOptions(userId: string | null) {
  const normalizedUserId = normalizeUserId(userId);
  return queryOptions({
    queryKey: walletTicketQueryKeys.list(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/ticket-passes",
            walletTicketListResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.tickets;
        }
      : skipToken,
    staleTime,
    gcTime: 5 * staleTime,
  });
}

export function walletTicketDetailQueryOptions(
  userId: string | null,
  ticketId: string | null,
) {
  const normalizedUserId = normalizeUserId(userId);
  const normalizedTicketId = ticketId
    ? parseBoundary(walletTicketIdSchema, ticketId, "Ticket ID")
    : null;
  return queryOptions({
    queryKey: walletTicketQueryKeys.detail(
      normalizedUserId,
      normalizedTicketId,
    ),
    queryFn:
      normalizedUserId && normalizedTicketId
        ? async ({ signal }) => {
            const response = await privateApiResponse(
              `/api/v1/ticket-passes/${normalizedTicketId}/family`,
              walletTicketDetailResponseSchema,
              { userId: normalizedUserId, signal },
            );
            return response.data.ticket;
          }
        : skipToken,
    staleTime,
    gcTime: 5 * staleTime,
  });
}

export function walletRecentScreeningQueryOptions(userId: string | null) {
  const normalizedUserId = normalizeUserId(userId);
  return queryOptions({
    queryKey: walletTicketQueryKeys.recentScreening(normalizedUserId),
    queryFn: normalizedUserId
      ? async ({ signal }) => {
          const response = await privateApiResponse(
            "/api/v1/ticket-passes/recent-screening",
            walletTicketRecentClickResponseSchema,
            { userId: normalizedUserId, signal },
          );
          return response.data.screening;
        }
      : skipToken,
    staleTime: 0,
    gcTime: 5 * staleTime,
    retry: false,
  });
}

export function recordWalletShowtimeClick(
  userId: string | null,
  value: WalletTicketRecentClick,
): void {
  if (!userId) return;
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  const input = parseBoundary(
    walletTicketRecentClickCreateSchema,
    value,
    "Recent showtime click",
  );
  const click = { ...input, clickedAt: new Date().toISOString() };
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    const queued = navigator.sendBeacon(
      "/api/v1/ticket-passes/recent-click",
      new Blob(
        [JSON.stringify({ ...click, expectedAccountId: normalizedUserId })],
        { type: "application/json" },
      ),
    );
    if (queued) return;
  }
  void privateApiResponse(
    "/api/v1/ticket-passes/recent-click",
    walletTicketRecentClickResponseSchema,
    {
      method: "POST",
      userId: normalizedUserId,
      body: click,
      keepalive: true,
    },
  ).catch(() => undefined);
}

export function createWalletTicketMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizeUserId(userId);
  return mutationOptions({
    mutationKey: ["walletTickets", "create", normalizedUserId],
    retry: false,
    mutationFn: async (value: WalletTicketCreate) => {
      if (!normalizedUserId) throw new Error("Log in to save tickets.");
      const input = parseBoundary(
        walletTicketCreateSchema,
        value,
        "Ticket details",
      );
      const response = await privateApiResponse(
        "/api/v1/ticket-passes",
        walletTicketChangeResponseSchema,
        { method: "POST", userId: normalizedUserId, body: input },
      );
      return response.data.ticket;
    },
    onSuccess: async () => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: walletTicketQueryKeys.list(normalizedUserId),
        exact: true,
      });
      await client.invalidateQueries({
        queryKey: walletTicketQueryKeys.recentScreening(normalizedUserId),
        exact: true,
      });
    },
  });
}

export function updateWalletTicketMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizeUserId(userId);
  return mutationOptions({
    mutationKey: ["walletTickets", "update", normalizedUserId],
    retry: false,
    mutationFn: async (value: {
      ticketId: string;
      patch: WalletTicketPatch;
    }) => {
      if (!normalizedUserId) throw new Error("Log in to update tickets.");
      const ticketId = parseBoundary(
        walletTicketIdSchema,
        value.ticketId,
        "Ticket ID",
      );
      const patch = parseBoundary(
        walletTicketPatchSchema,
        value.patch,
        "Ticket changes",
      );
      const response = await privateApiResponse(
        `/api/v1/ticket-passes/${ticketId}`,
        walletTicketChangeResponseSchema,
        { method: "PATCH", userId: normalizedUserId, body: patch },
      );
      return response.data.ticket;
    },
    onSuccess: async (ticket) => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: walletTicketQueryKeys.list(normalizedUserId),
        exact: true,
      });
      await client.invalidateQueries({
        queryKey: walletTicketQueryKeys.detail(normalizedUserId, ticket.id),
        exact: true,
      });
    },
  });
}

export function deleteWalletTicketMutationOptions(
  userId: string | null,
  client: QueryClient = queryClient,
) {
  const normalizedUserId = normalizeUserId(userId);
  return mutationOptions({
    mutationKey: ["walletTickets", "delete", normalizedUserId],
    retry: false,
    mutationFn: async (value: string) => {
      if (!normalizedUserId) throw new Error("Log in to delete tickets.");
      const ticketId = parseBoundary(walletTicketIdSchema, value, "Ticket ID");
      await privateApiResponse(
        `/api/v1/ticket-passes/${ticketId}`,
        walletTicketRemoveResponseSchema,
        { method: "DELETE", userId: normalizedUserId },
      );
      return ticketId;
    },
    onSuccess: async (ticketId) => {
      if (!normalizedUserId) return;
      await client.invalidateQueries({
        queryKey: walletTicketQueryKeys.list(normalizedUserId),
        exact: true,
      });
      client.removeQueries({
        queryKey: walletTicketQueryKeys.detail(normalizedUserId, ticketId),
        exact: true,
      });
    },
  });
}
