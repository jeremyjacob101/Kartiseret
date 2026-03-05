import { createContext, useContext } from "react";
import {
  ALL_RATING_SOURCES,
  DEFAULT_RATING_SOURCES,
  type RatingSource,
} from "./ratingSources";
import { type RatingSourcesState } from "./useRatingSources";

export type RatingSourcesContextValue = RatingSourcesState & {
  allSources: readonly RatingSource[];
};

const fallbackValue: RatingSourcesContextValue = {
  user: null,
  sources: DEFAULT_RATING_SOURCES,
  loading: false,
  syncing: false,
  error: null,
  allSources: ALL_RATING_SOURCES,
  saveSources: async () => false,
};

export const RatingSourcesContext = createContext<RatingSourcesContextValue | null>(
  null,
);

export function useRatingSourcesContext(): RatingSourcesContextValue {
  return useContext(RatingSourcesContext) ?? fallbackValue;
}
