import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase";
import {
  DEFAULT_RATING_SOURCES,
  normalizeRatingSources,
  saveLocalRatingSources,
  type RatingSource,
} from "./ratingSources";

type UserPreferencesRow = {
  user_id: string;
  rating_sources: RatingSource[] | null;
};

export type RatingSourcesState = {
  user: User | null;
  sources: RatingSource[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  saveSources: (sources: readonly RatingSource[]) => Promise<boolean>;
};

const PREFERENCES_TABLE = "user_preferences_ratings";
const supabase = getSupabaseBrowserClient();

export function useRatingSources(): RatingSourcesState {
  const [user, setUser] = useState<User | null>(null);
  const [sources, setSources] = useState<RatingSource[]>([
    ...DEFAULT_RATING_SOURCES,
  ]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;
  const sourcesRef = useRef<RatingSource[]>(sources);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

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
      setLoading(false);
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
    let cancelled = false;

    async function syncSourcesWithUser() {
      if (!userId) {
        const defaultSources = [...DEFAULT_RATING_SOURCES];
        setError(null);
        setSources(defaultSources);
        saveLocalRatingSources(defaultSources);
        setSyncing(false);
        return;
      }

      setSyncing(true);
      setError(null);

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
        return;
      }

      const row = (data as UserPreferencesRow | null) ?? null;

      if (!row) {
        const defaultSources = [...DEFAULT_RATING_SOURCES];
        const { error: createError } = await supabase
          .from(PREFERENCES_TABLE)
          .upsert(
            {
              user_id: userId,
              rating_sources: defaultSources,
            } satisfies UserPreferencesRow,
            { onConflict: "user_id" },
          );

        if (cancelled) {
          return;
        }

        if (createError) {
          setError(createError.message);
          setSyncing(false);
          return;
        }

        setSources(defaultSources);
        saveLocalRatingSources(defaultSources);
        setSyncing(false);
        return;
      }

      const normalized = normalizeRatingSources(row.rating_sources, {
        allowEmpty: true,
      });
      setSources(normalized);
      saveLocalRatingSources(normalized, { allowEmpty: true });
      setSyncing(false);
    }

    void syncSourcesWithUser();

    return () => {
      cancelled = true;
    };
  }, [userId]);

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
      saveLocalRatingSources(normalized, { allowEmpty: true });

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
        saveLocalRatingSources(previous, { allowEmpty: true });
        return false;
      }

      return true;
    },
    [userId],
  );

  return {
    user,
    sources,
    loading,
    syncing,
    error,
    saveSources,
  };
}
