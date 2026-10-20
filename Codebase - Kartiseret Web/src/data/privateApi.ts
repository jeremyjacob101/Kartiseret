import { ApiRequestError, requestApiResponse } from "./apiClient";
import { getAuthClient } from "../lib/authClient";
import { queryClient } from "../lib/queryClient";
import type { z } from "zod";

let identityGeneration = 0;
let activeAccount: string | null | undefined;
export function privateIdentityChanged(userId: string | null): void {
  if (activeAccount === userId) return;
  activeAccount = userId;
  identityGeneration += 1;
  const filter = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === "adminStatus" ||
      (query.queryKey[0] === "ticketAlerts" &&
        query.queryKey[1] === "subscriptions"),
  };
  void queryClient.cancelQueries(filter);
  queryClient.removeQueries(filter);
}
export async function privateApiResponse<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    userId?: string;
  } = {},
): Promise<z.output<Schema>> {
  const startedGeneration = identityGeneration;
  const { data, error } = await getAuthClient().getSession();
  const user = data?.user;
  if (error || !user || (options.userId && user.id !== options.userId)) {
    throw new ApiRequestError(
      401,
      "unauthorized",
      "Create an account or log in to manage your account.",
    );
  }
  if (startedGeneration !== identityGeneration && activeAccount !== user.id)
    throw new DOMException("Account changed", "AbortError");
  if (activeAccount !== user.id) privateIdentityChanged(user.id);
  const generation = identityGeneration;
  const response = await requestApiResponse(path, schema, {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  if (generation !== identityGeneration)
    throw new DOMException("Account changed", "AbortError");
  return response;
}
