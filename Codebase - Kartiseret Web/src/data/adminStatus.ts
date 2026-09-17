import { adminUserRowSchema, supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { parseBoundary } from "../validation/runtime";

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
  const supabase = getSupabaseBrowserClient();
  let query = supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId);

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(
    data
      ? parseBoundary(adminUserRowSchema, data, "admin status response")
      : null,
  );
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
