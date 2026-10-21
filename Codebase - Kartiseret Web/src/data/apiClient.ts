import { apiErrorResponseSchema, PUBLICATION_REVISION_HEADER } from "@kartiseret/contracts/public-data";
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
  return requestApiResponse(path, schema, { method: "GET", signal });
}

export async function requestApiResponse<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: RequestInit,
  inspectResponse?: (response: Response) => void,
): Promise<z.output<Schema>> {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    credentials: "same-origin",
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
  inspectResponse?.(response);
  return result.data;
}

export async function getPublicationResponse<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  signal?: AbortSignal,
  expectedRevision?: string,
): Promise<{ response: z.output<Schema>; revision: string }> {
  let revision: string | undefined;
  const response = await requestApiResponse(
    path,
    schema,
    {
      method: "GET",
      signal,
      cache: "no-store",
      headers:
        expectedRevision === undefined
          ? {}
          : { [PUBLICATION_REVISION_HEADER]: expectedRevision },
    },
    (httpResponse) => {
      const value = httpResponse.headers.get(PUBLICATION_REVISION_HEADER);
      if (value === null || !/^(0|[1-9][0-9]{0,18})$/.test(value))
        throw new ApiRequestError(
          502,
          "invalid_response",
          "The API publication revision is unavailable.",
        );
      if (expectedRevision !== undefined && value !== expectedRevision)
        throw new ApiRequestError(
          409,
          "publication_changed",
          "Published data changed. Reload the catalog.",
        );
      revision = value;
    },
  );
  if (revision === undefined)
    throw new Error("Publication response was not inspected.");
  return { response, revision };
}
