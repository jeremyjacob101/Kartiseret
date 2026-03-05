import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase";
import {
  DEFAULT_RATING_SOURCES,
  normalizeRatingSources,
  type RatingSource,
} from "./ratingSources";
import {
  DEFAULT_LOCATION,
  loadGuestLocation,
  normalizeLocation,
  saveGuestLocation,
  type AppLocation,
} from "./locations";

type UserPreferencesRow = {
  user_id: string;
  rating_sources: RatingSource[] | null;
  location?: AppLocation | null;
};

export type RatingSourcesState = {
  user: User | null;
  sources: RatingSource[];
  location: AppLocation;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  saveSources: (sources: readonly RatingSource[]) => Promise<boolean>;
  setLocationPreference: (location: AppLocation) => Promise<boolean>;
};

const PREFERENCES_TABLE = "user_preferences_ratings";
const LOCATION_COLUMN = "location";
const supabase = getSupabaseBrowserClient();

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const target = column.toLowerCase();

  return (
    message.includes(target) &&
    (message.includes("column") || message.includes("schema cache"))
  );
}

export function useRatingSources(): RatingSourcesState {
  const [user, setUser] = useState<User | null>(null);
  const [sources, setSources] = useState<RatingSource[]>([
    ...DEFAULT_RATING_SOURCES,
  ]);
  const [location, setLocation] = useState<AppLocation>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const userId = user?.id ?? null;
  const sourcesRef = useRef<RatingSource[]>(sources);
  const locationRef = useRef<AppLocation>(location);
  const hasLocationColumnRef = useRef<boolean | null>(null);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    let isActive = true;

    async function initializeSession() {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!isActive) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
      }

      setUser(data.session?.user ?? null);
      setSessionResolved(true);
    }

    void initializeSession();

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      },
    );

    return () => {
      isActive = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionResolved) {
      return;
    }

    let cancelled = false;

    async function syncPreferencesWithUser() {
      setError(null);
      setLoading(true);

      if (!userId) {
        const guestLocation = loadGuestLocation() ?? DEFAULT_LOCATION;
        setSources([...DEFAULT_RATING_SOURCES]);
        setLocation(guestLocation);
        setSyncing(false);
        setLoading(false);
        return;
      }

      setSyncing(true);

      let rowData: UserPreferencesRow | null = null;

      if (hasLocationColumnRef.current !== false) {
        const { data, error: loadError } = await supabase
          .from(PREFERENCES_TABLE)
          .select("user_id, rating_sources, location")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        if (loadError && isMissingColumnError(loadError, LOCATION_COLUMN)) {
          hasLocationColumnRef.current = false;
        } else if (loadError) {
          setError(loadError.message);
          setSyncing(false);
          setLoading(false);
          return;
        } else {
          hasLocationColumnRef.current = true;
          rowData = (data as UserPreferencesRow | null) ?? null;
        }
      }

      if (hasLocationColumnRef.current === false) {
        const { data, error: loadError } = await supabase
          .from(PREFERENCES_TABLE)
          .select("user_id, rating_sources")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        if (loadError) {
          setError(loadError.message);
          setSyncing(false);
          setLoading(false);
          return;
        }

        rowData = (data as UserPreferencesRow | null) ?? null;
      }

      if (!rowData) {
        const defaultSources = [...DEFAULT_RATING_SOURCES];

        const createPayload: {
          user_id: string;
          rating_sources: RatingSource[];
          location?: AppLocation;
        } = {
          user_id: userId,
          rating_sources: defaultSources,
        };

        if (hasLocationColumnRef.current !== false) {
          createPayload.location = DEFAULT_LOCATION;
        }

        const { error: createError } = await supabase
          .from(PREFERENCES_TABLE)
          .upsert(createPayload, { onConflict: "user_id" });

        if (cancelled) {
          return;
        }

        if (createError && isMissingColumnError(createError, LOCATION_COLUMN)) {
          hasLocationColumnRef.current = false;
          const { error: retryError } = await supabase
            .from(PREFERENCES_TABLE)
            .upsert(
              {
                user_id: userId,
                rating_sources: defaultSources,
              },
              { onConflict: "user_id" },
            );

          if (cancelled) {
            return;
          }

          if (retryError) {
            setError(retryError.message);
            setSyncing(false);
            setLoading(false);
            return;
          }
        } else if (createError) {
          setError(createError.message);
          setSyncing(false);
          setLoading(false);
          return;
        }

        setSources(defaultSources);
        setLocation(DEFAULT_LOCATION);
        setSyncing(false);
        setLoading(false);
        return;
      }

      const normalizedSources = normalizeRatingSources(rowData.rating_sources, {
        allowEmpty: true,
      });
      const normalizedLocation =
        hasLocationColumnRef.current === false
          ? DEFAULT_LOCATION
          : normalizeLocation(rowData.location, DEFAULT_LOCATION);

      setSources(normalizedSources);
      setLocation(normalizedLocation);
      setSyncing(false);
      setLoading(false);
    }

    void syncPreferencesWithUser();

    return () => {
      cancelled = true;
    };
  }, [sessionResolved, userId]);

  const saveSources = useCallback(
    async (nextSourcesInput: readonly RatingSource[]) => {
      if (!userId) {
        setError("You must be logged in to save preferences.");
        return false;
      }

      setError(null);
      const normalized = normalizeRatingSources(nextSourcesInput, {
        allowEmpty: true,
      });

      const previous = sourcesRef.current;
      setSyncing(true);
      setSources(normalized);

      const { error: upsertError } = await supabase.from(PREFERENCES_TABLE).upsert(
        {
          user_id: userId,
          rating_sources: normalized,
        } satisfies UserPreferencesRow,
        { onConflict: "user_id" },
      );

      setSyncing(false);

      if (upsertError) {
        setError(upsertError.message);
        setSources(previous);
        return false;
      }

      return true;
    },
    [userId],
  );

  const setLocationPreference = useCallback(
    async (nextLocationInput: AppLocation) => {
      const normalizedLocation = normalizeLocation(nextLocationInput, DEFAULT_LOCATION);
      setError(null);

      if (!userId) {
        saveGuestLocation(normalizedLocation);
        setLocation(normalizedLocation);
        return true;
      }

      if (hasLocationColumnRef.current === false) {
        setError(
          "Add a `location` column to public.user_preferences_ratings to persist locations.",
        );
        return false;
      }

      const previous = locationRef.current;
      setSyncing(true);
      setLocation(normalizedLocation);

      const { error: upsertError } = await supabase.from(PREFERENCES_TABLE).upsert(
        {
          user_id: userId,
          location: normalizedLocation,
        },
        { onConflict: "user_id" },
      );

      setSyncing(false);

      if (upsertError) {
        if (isMissingColumnError(upsertError, LOCATION_COLUMN)) {
          hasLocationColumnRef.current = false;
          setError(
            "Add a `location` column to public.user_preferences_ratings to persist locations.",
          );
        } else {
          setError(upsertError.message);
        }

        setLocation(previous);
        return false;
      }

      hasLocationColumnRef.current = true;
      return true;
    },
    [userId],
  );

  return {
    user,
    sources,
    location,
    loading,
    syncing,
    error,
    saveSources,
    setLocationPreference,
  };
}
