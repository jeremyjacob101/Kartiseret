import { useLocation, useNavigate, type NavigateOptions } from "react-router";
import { createContext, useCallback, useContext, useMemo } from "react";
import { resolvePublicPathForLegacyPath } from "../data/publicRoutes";
import { usePublicRoutePaths } from "./PublicRoutePathsContext";

export const PublicRouteLocationContext = createContext<string | null>(null);

export function usePublicRouteLocation() {
  const location = useLocation();
  const renderPath = useContext(PublicRouteLocationContext);
  if (!renderPath) return location;

  let parsed: URL;
  try {
    parsed = new URL(renderPath, "https://seret.site");
  } catch {
    return location;
  }
  if (parsed.origin !== "https://seret.site") return location;

  return { ...location, pathname: parsed.pathname, search: parsed.search };
}

type SearchParamsInput =
  string | URLSearchParams | Record<string, string> | Array<[string, string]>;

function copySearchParams(input: SearchParamsInput): URLSearchParams {
  if (typeof input === "string") {
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  }
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  return new URLSearchParams(input);
}

export function usePublicRouteSearchParams(): [
  URLSearchParams,
  (
    next: SearchParamsInput | ((current: URLSearchParams) => SearchParamsInput),
    options?: NavigateOptions,
  ) => void,
] {
  const actualLocation = useLocation();
  const logicalLocation = usePublicRouteLocation();
  const renderPath = useContext(PublicRouteLocationContext);
  const routePaths = usePublicRoutePaths();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(logicalLocation.search),
    [logicalLocation.search],
  );

  const setSearchParams = useCallback(
    (
      next:
        SearchParamsInput | ((current: URLSearchParams) => SearchParamsInput),
      options?: NavigateOptions,
    ) => {
      const resolved = copySearchParams(
        typeof next === "function"
          ? next(new URLSearchParams(logicalLocation.search))
          : next,
      );
      const search = resolved.toString();

      if (renderPath) {
        const nextPath = `${logicalLocation.pathname}${search ? `?${search}` : ""}`;
        const candidatePath = routePaths[nextPath];
        const mappedPath =
          candidatePath && /^\/[a-z0-9]{8}$/.test(candidatePath)
            ? candidatePath
            : null;
        if (mappedPath) {
          navigate(`${mappedPath}${actualLocation.hash}`, options);
          return;
        }
        void resolvePublicPathForLegacyPath(nextPath)
          .then((opaquePath) => {
            navigate(`${opaquePath}${actualLocation.hash}`, options);
          })
          .catch(() => undefined);
        return;
      }

      navigate(
        {
          pathname: actualLocation.pathname,
          search: search ? `?${search}` : "",
          hash: actualLocation.hash,
        },
        options,
      );
    },
    [
      actualLocation.hash,
      actualLocation.pathname,
      logicalLocation.pathname,
      logicalLocation.search,
      navigate,
      renderPath,
      routePaths,
    ],
  );

  return [params, setSearchParams];
}
