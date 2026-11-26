import { PublicRouteLocationContext } from "./PublicRouteLocation";
import type { ReactNode } from "react";

export function PublicRouteLocationProvider({
  renderPath,
  children,
}: {
  renderPath: string | null;
  children: ReactNode;
}) {
  return (
    <PublicRouteLocationContext.Provider value={renderPath}>
      {children}
    </PublicRouteLocationContext.Provider>
  );
}
