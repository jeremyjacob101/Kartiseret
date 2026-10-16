import { apiErrorResponseSchema } from "@kartiseret/contracts/public-data";
import type { z } from "zod";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function getApiResponse<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    signal,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError(
      response.status,
      "invalid_response",
      "The API returned an invalid response.",
    );
  }

  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(body);
    throw new ApiRequestError(
      response.status,
      error.success ? error.data.error.code : "request_failed",
      error.success
        ? error.data.error.message
        : "The request could not be completed.",
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiRequestError(
      response.status,
      "invalid_response",
      "The API response did not match the expected data contract.",
    );
  }
  return result.data;
}
