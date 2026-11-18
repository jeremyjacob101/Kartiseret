import { PublicRouteComponentsContext, type PublicRouteComponents } from "./PublicRouteComponentsContext.js";
import type { ReactNode } from "react";

export function PublicRouteComponentsProvider({
  children,
  components,
}: {
  children: ReactNode;
  components: PublicRouteComponents;
}) {
  return (
    <PublicRouteComponentsContext.Provider value={components}>
      {children}
    </PublicRouteComponentsContext.Provider>
  );
}
