import { PublicRoutePathsContext } from "./PublicRoutePathsContext";
import type { ReactNode } from "react";

export function PublicRoutePathsProvider({
  paths,
  children,
}: {
  paths: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <PublicRoutePathsContext.Provider value={paths}>
      {children}
    </PublicRoutePathsContext.Provider>
  );
}
