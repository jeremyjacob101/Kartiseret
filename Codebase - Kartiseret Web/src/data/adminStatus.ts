import { accountResponseSchema } from "@kartiseret/contracts/private-data";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { parseBoundary } from "@kartiseret/contracts/runtime";
import { privateApiResponse } from "./privateApi";

const ADMIN_STATUS_STALE_TIME = 5 * 60 * 1000;
const ADMIN_STATUS_GC_TIME = 30 * 60 * 1000;

export const adminStatusQueryKeys = {
  all: ["adminStatus"] as const,
  byUser: (userId: string) => ["adminStatus", "user", userId] as const,
};

async function fetchAdminStatus(
  userId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await privateApiResponse(
    "/api/v1/account",
    accountResponseSchema,
    { userId, signal },
  );
  if (response.data.user.id !== userId)
    throw new Error("Account response did not match this user.");
  return response.data.isAdmin;
}

export function adminStatusQueryOptions(userId: string | null) {
  const validatedUserId = userId
    ? parseBoundary(supabaseUserIdSchema, userId, "admin status user ID")
    : null;
  return queryOptions({
    queryKey: adminStatusQueryKeys.byUser(validatedUserId ?? "anonymous"),
    queryFn: validatedUserId
      ? ({ signal }) => fetchAdminStatus(validatedUserId, signal)
      : skipToken,
    staleTime: ADMIN_STATUS_STALE_TIME,
    gcTime: ADMIN_STATUS_GC_TIME,
  });
}
