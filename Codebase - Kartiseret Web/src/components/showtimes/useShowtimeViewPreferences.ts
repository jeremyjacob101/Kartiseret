import { copyShowtimePreferences, DEFAULT_SHOWTIME_PREFERENCES, normalizeShowtimePreferences, type ShowtimePreferences } from "@kartiseret/contracts/showtime-preferences";
import { normalizeLocation, type AppLocation } from "../../prefs/definitions/locations";
import { useUserPreferencesStore } from "../../stores/userPreferencesStore";
import type { ShowtimeFilterState } from "./showtimeFilters";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

type ShowtimeViewSnapshot = {
  screeningFilters: ShowtimeFilterState;
  excludedCinemaIds: string[];
  location: AppLocation;
};

type ShowtimeViewSession = {
  identity: string;
  viewKey: string;
  ready: boolean;
  value: ShowtimeViewSnapshot;
};

function snapshotFromPreferences(
  preferences: ShowtimePreferences,
  location: AppLocation,
): ShowtimeViewSnapshot {
  const copied = copyShowtimePreferences(preferences);
  return {
    screeningFilters: copied.screeningFilters,
    excludedCinemaIds: copied.excludedCinemaIds,
    location,
  };
}

export function useShowtimeViewPreferences(viewKey: string) {
  const {
    userId,
    loading,
    loadError,
    error,
    retryPreferenceLoad,
    preferences,
    savedLocation,
  } = useUserPreferencesStore(
    useShallow((state) => ({
      userId: state.user?.id ?? null,
      loading: state.loading && !state.documentDisplay,
      loadError: state.loadError && !state.documentDisplay,
      error: state.error,
      retryPreferenceLoad: state.retryPreferenceLoad,
      preferences: state.preferences.showtimePreferences,
      savedLocation: state.preferences.location,
    })),
  );
  const identity = userId ?? "guest";
  const savedSnapshot = useMemo(
    () => snapshotFromPreferences(preferences, savedLocation),
    [preferences, savedLocation],
  );
  const [session, setSession] = useState<ShowtimeViewSession>(() => ({
    identity,
    viewKey,
    ready: !loading && !loadError,
    value: savedSnapshot,
  }));
  if (
    session.identity !== identity ||
    session.viewKey !== viewKey ||
    (!session.ready && !loading && !loadError)
  ) {
    setSession({
      identity,
      viewKey,
      ready: !loading && !loadError,
      value: savedSnapshot,
    });
  }
  const sessionMatches =
    session.identity === identity &&
    session.viewKey === viewKey &&
    session.ready;
  const value = sessionMatches ? session.value : savedSnapshot;

  const update = useCallback(
    (next: Partial<ShowtimeViewSnapshot>) => {
      setSession((current) => {
        const currentMatches =
          current.identity === identity &&
          current.viewKey === viewKey &&
          current.ready;
        const base = currentMatches ? current.value : savedSnapshot;
        const normalized = normalizeShowtimePreferences({
          screeningFilters: next.screeningFilters ?? base.screeningFilters,
          excludedCinemaIds: next.excludedCinemaIds ?? base.excludedCinemaIds,
        });
        return {
          identity,
          viewKey,
          ready: !loading && !loadError,
          value: {
            screeningFilters: normalized.screeningFilters,
            excludedCinemaIds: normalized.excludedCinemaIds,
            location: normalizeLocation(next.location ?? base.location),
          },
        };
      });
    },
    [identity, loadError, loading, savedSnapshot, viewKey],
  );

  const setScreeningFilters = useCallback(
    (screeningFilters: ShowtimeFilterState) => update({ screeningFilters }),
    [update],
  );
  const setExcludedCinemaIds = useCallback(
    (excludedCinemaIds: readonly string[]) =>
      update({ excludedCinemaIds: [...excludedCinemaIds] }),
    [update],
  );
  const setLocation = useCallback(
    (location: AppLocation) => update({ location }),
    [update],
  );
  const restoreDefaults = useCallback(
    () =>
      update({
        screeningFilters: preferences.screeningFilters,
        excludedCinemaIds: preferences.excludedCinemaIds,
        location: savedLocation,
      }),
    [preferences, savedLocation, update],
  );
  const showEverything = useCallback(
    () =>
      update({
        screeningFilters: DEFAULT_SHOWTIME_PREFERENCES.screeningFilters,
        excludedCinemaIds: [],
      }),
    [update],
  );
  const retry = useCallback(() => {
    setSession((current) => ({ ...current, ready: false }));
    retryPreferenceLoad();
  }, [retryPreferenceLoad]);

  return {
    ...value,
    ready: !loading && !loadError && sessionMatches,
    loadError: loadError ? error : null,
    retry,
    setScreeningFilters,
    setExcludedCinemaIds,
    setLocation,
    restoreDefaults,
    showEverything,
  };
}
