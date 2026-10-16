export interface VercelDispatchRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  url?: string;
}

export interface VercelDispatchResponse {
  status(statusCode: number): VercelDispatchResponse;
  setHeader(
    name: string,
    value: string | number | readonly string[],
  ): VercelDispatchResponse;
  send(body: unknown): VercelDispatchResponse;
}

export type VercelDispatchHandler = (
  request: VercelDispatchRequest,
  response: VercelDispatchResponse,
) => void | Promise<void>;

export interface VercelDispatchHandlers {
  api: VercelDispatchHandler;
  og: VercelDispatchHandler;
  ogImage: VercelDispatchHandler;
}

const INTERNAL_ROUTE_PARAMETER = "__vercel_route";
const API_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

function getDispatchPath(
  request: VercelDispatchRequest,
  requestUrl: URL,
): string | null {
  const routeParameter = request.query[INTERNAL_ROUTE_PARAMETER];
  const routeFromQuery = requestUrl.searchParams.get(INTERNAL_ROUTE_PARAMETER);
  const route = Array.isArray(routeParameter)
    ? routeParameter.at(-1)
    : (routeParameter ?? routeFromQuery);

  if (typeof route !== "string") {
    return null;
  }

  const normalizedRoute = route.replace(/^\/+|\/+$/g, "");
  return API_PATH_PATTERN.test(normalizedRoute) ? normalizedRoute : null;
}

export function createVercelDispatchHandler({
  api,
  og,
  ogImage,
}: VercelDispatchHandlers): VercelDispatchHandler {
  return (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://vercel.internal");
    const dispatchPath = getDispatchPath(request, requestUrl);
    requestUrl.searchParams.delete(INTERNAL_ROUTE_PARAMETER);
    request.url = `/api/${dispatchPath ?? "dispatch"}${requestUrl.search}`;
    delete request.query[INTERNAL_ROUTE_PARAMETER];

    if (dispatchPath === "og") {
      return og(request, response);
    }
    if (dispatchPath === "og-image") {
      return ogImage(request, response);
    }

    return api(request, response);
  };
}
