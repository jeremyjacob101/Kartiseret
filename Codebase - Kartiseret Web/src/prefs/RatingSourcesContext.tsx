import { type PropsWithChildren } from "react";
import { ALL_RATING_SOURCES } from "./ratingSources";
import { ALL_LOCATIONS } from "./locations";
import { RatingSourcesContext } from "./ratingSourcesStore";
import { useRatingSources } from "./useRatingSources";

export function RatingSourcesProvider({ children }: PropsWithChildren) {
  const state = useRatingSources();

  return (
    <RatingSourcesContext.Provider
      value={{
        ...state,
        allSources: ALL_RATING_SOURCES,
        allLocations: ALL_LOCATIONS,
      }}
    >
      {children}
    </RatingSourcesContext.Provider>
  );
}
