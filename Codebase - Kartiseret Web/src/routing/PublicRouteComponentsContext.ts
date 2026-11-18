import { createContext, useContext, type ComponentType } from "react";

export type PublicRouteComponents = {
  allShowtimesPage?: ComponentType;
  cinemaPage?: ComponentType;
};

export const PublicRouteComponentsContext =
  createContext<PublicRouteComponents>({});

export function usePublicRouteComponents() {
  return useContext(PublicRouteComponentsContext);
}
