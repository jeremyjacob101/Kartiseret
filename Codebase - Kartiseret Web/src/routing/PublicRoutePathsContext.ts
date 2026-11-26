import { createContext, useContext } from "react";

const EMPTY_PUBLIC_ROUTE_PATHS: Record<string, string> = Object.freeze({});

export const PublicRoutePathsContext = createContext<Record<
  string,
  string
> | null>(null);

export function usePublicRoutePaths(): Record<string, string> {
  return useContext(PublicRoutePathsContext) ?? EMPTY_PUBLIC_ROUTE_PATHS;
}

export function useHasPublicRoutePaths(): boolean {
  return useContext(PublicRoutePathsContext) !== null;
}
