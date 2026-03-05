import { createContext, useContext } from "react";
import {
  ALL_RATING_SOURCES,
  DEFAULT_RATING_SOURCES,
  type RatingSource,
} from "./ratingSources";
import {
  ALL_LOCATIONS,
  DEFAULT_LOCATION,
  type AppLocation,
} from "./locations";
import { type RatingSourcesState } from "./useRatingSources";

export type RatingSourcesContextValue = RatingSourcesState & {
  allSources: readonly RatingSource[];
  allLocations: readonly AppLocation[];
};

const fallbackValue: RatingSourcesContextValue = {
  user: null,
  sources: DEFAULT_RATING_SOURCES,
  location: DEFAULT_LOCATION,
  loading: false,
  syncing: false,
  error: null,
  allSources: ALL_RATING_SOURCES,
  allLocations: ALL_LOCATIONS,
  saveSources: async () => false,
  setLocationPreference: async () => false,
};

export const RatingSourcesContext = createContext<RatingSourcesContextValue | null>(
  null,
);

export function useRatingSourcesContext(): RatingSourcesContextValue {
  return useContext(RatingSourcesContext) ?? fallbackValue;
}
