import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { locationPreferenceDefinition, type AppLocation } from "./definitions/locations";
import { ratingSourcesPreferenceDefinition, type RatingSource } from "./definitions/ratingSources";
import { DEFAULT_SITE_COLOR, applySiteColor, initializeSiteColorTheme, siteColorPreferenceDefinition, type SiteColorOption, type SiteColor } from "./definitions/siteColor";
import type { UserPreferenceDefinition } from "./definitions/shared";

const PREFERENCES_TABLE = "userPreferences";
const supabase = getSupabaseBrowserClient();
initializeSiteColorTheme();

const preferenceDefinitions = {
  ratingSources: ratingSourcesPreferenceDefinition,
  location: locationPreferenceDefinition,
  siteColor: siteColorPreferenceDefinition,
} as const;

type PreferenceDefinitions = typeof preferenceDefinitions;
type PreferenceKey = keyof PreferenceDefinitions;
type PreferenceDefinition = PreferenceDefinitions[PreferenceKey];
type PreferenceValue<Definition> =
  Definition extends UserPreferenceDefinition<string, infer Value, never>
    ? Value
    : Definition extends UserPreferenceDefinition<string, infer Value, unknown>
      ? Value
      : never;
type PreferenceOption<Definition> =
  Definition extends UserPreferenceDefinition<string, unknown, infer Option>
    ? Option
    : never;
type UserPreferences = {
  [Key in PreferenceKey]: PreferenceValue<PreferenceDefinitions[Key]>;
};
type UserPreferenceOptions = {
  [Key in PreferenceKey]:
    | readonly PreferenceOption<PreferenceDefinitions[Key]>[]
    | undefined;
};
type SavePreference = <Key extends PreferenceKey>(
  key: Key,
  value: UserPreferences[Key],
) => Promise<boolean>;
type UserPreferencesRow = {
  user_id: string;
} & Record<string, unknown>;
type QueuedPreferenceSaves = Partial<{
  [Key in PreferenceKey]: UserPreferences[Key];
}>;

export type UserPreferencesState = {
  user: User | null;
  preferences: UserPreferences;
  preferenceOptions: UserPreferenceOptions;
  sources: RatingSource[];
  allSources: readonly RatingSource[];
  location: AppLocation;
  allLocations: readonly AppLocation[];
  allSiteColors: readonly SiteColorOption[];
  siteColor: SiteColor;
  defaultSiteColor: SiteColor;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  savePreference: SavePreference;
  saveSources: (sources: readonly RatingSource[]) => Promise<boolean>;
  saveLocation: (location: AppLocation) => Promise<boolean>;
  saveSiteColor: (siteColor: SiteColor) => Promise<boolean>;
  resetSiteColor: () => Promise<boolean>;
  setLocationPreference: (location: AppLocation) => Promise<boolean>;
};

export type UserPreferencesContextValue = UserPreferencesState;

const preferenceKeys = Object.keys(preferenceDefinitions) as PreferenceKey[];
const defaultPreferences = createPreferenceValues((key) =>
  getDefaultPreferenceValue(key));
const preferenceOptions = createPreferenceOptions();
const fallbackSavePreference: SavePreference = async () => false;

const fallbackValue: UserPreferencesContextValue = {
  user: null,
  preferences: defaultPreferences,
  preferenceOptions,
  sources: defaultPreferences.ratingSources,
  allSources: preferenceOptions.ratingSources ?? [],
  location: defaultPreferences.location,
  allLocations: preferenceOptions.location ?? [],
  allSiteColors: preferenceOptions.siteColor ?? [],
  siteColor: defaultPreferences.siteColor,
  defaultSiteColor: DEFAULT_SITE_COLOR,
  loading: false,
  syncing: false,
  error: null,
  savePreference: fallbackSavePreference,
  saveSources: async () => false,
  saveLocation: async () => false,
  saveSiteColor: async () => false,
  resetSiteColor: async () => false,
  setLocationPreference: async () => false,
};

export const UserPreferencesContext =
  createContext<UserPreferencesContextValue | null>(null);

function getPreferenceDefinition<Key extends PreferenceKey>(
  key: Key,
): PreferenceDefinitions[Key] {
  return preferenceDefinitions[key];
}

function createPreferenceValues(
  getValue: (
    key: PreferenceKey,
    definition: PreferenceDefinition,
  ) => UserPreferences[PreferenceKey],
): UserPreferences {
  const values = {} as UserPreferences;

  for (const key of preferenceKeys) {
    values[key] = getValue(key, preferenceDefinitions[key]) as never;
  }

  return values;
}

function createPreferenceOptions(): UserPreferenceOptions {
  const options = {} as UserPreferenceOptions;

  for (const key of preferenceKeys) {
    options[key] = getPreferenceDefinition(key).options as never;
  }

  return options;
}

function createPreferenceKeyRecord<Value>(
  getValue: (key: PreferenceKey) => Value,
): Record<PreferenceKey, Value> {
  const values = {} as Record<PreferenceKey, Value>;

  for (const key of preferenceKeys) {
    values[key] = getValue(key);
  }

  return values;
}

function copyPreferenceValue<Key extends PreferenceKey>(
  key: Key,
  value: UserPreferences[Key],
): UserPreferences[Key] {
  const copy = getPreferenceDefinition(key).copy as unknown as (
    value: UserPreferences[Key],
  ) => UserPreferences[Key];

  return copy(value);
}

function normalizePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  value: unknown,
): UserPreferences[Key] {
  const normalize = getPreferenceDefinition(key).normalize as (
    value: unknown,
  ) => UserPreferences[Key];

  return normalize(value);
}

function getDefaultPreferenceValue<Key extends PreferenceKey>(
  key: Key,
): UserPreferences[Key] {
  return copyPreferenceValue(
    key,
    getPreferenceDefinition(key).defaultValue as UserPreferences[Key],
  );
}

function updatePreferenceValue<Key extends PreferenceKey>(
  current: UserPreferences,
  key: Key,
  value: UserPreferences[Key],
): UserPreferences {
  return {
    ...current,
    [key]: copyPreferenceValue(key, value),
  };
}

function arePreferenceValuesEqual<Key extends PreferenceKey>(
  key: Key,
  left: UserPreferences[Key],
  right: UserPreferences[Key],
): boolean {
  const leftCopy = copyPreferenceValue(key, left);
  const rightCopy = copyPreferenceValue(key, right);

  if (Array.isArray(leftCopy) && Array.isArray(rightCopy)) {
    if (leftCopy.length !== rightCopy.length) {
      return false;
    }

    return leftCopy.every((entry, index) => entry === rightCopy[index]);
  }

  return Object.is(leftCopy, rightCopy);
}

function getBootstrappedPreferences(): UserPreferences {
  return createPreferenceValues((key) => {
    const cachedValue = getPreferenceDefinition(key).clientCache?.load();

    if (cachedValue === null || cachedValue === undefined) {
      return getDefaultPreferenceValue(key);
    }

    return normalizePreferenceValue(key, cachedValue);
  });
}

function saveCachedPreference<Key extends PreferenceKey>(
  key: Key,
  value: UserPreferences[Key],
): void {
  const save = getPreferenceDefinition(key).clientCache?.save as
    | ((nextValue: UserPreferences[Key]) => void)
    | undefined;

  save?.(copyPreferenceValue(key, value));
}

function saveCachedPreferences(preferences: UserPreferences): void {
  for (const key of preferenceKeys) {
    saveCachedPreference(key, preferences[key]);
  }
}

function clearCachedPreferences(): void {
  for (const key of preferenceKeys) {
    getPreferenceDefinition(key).clientCache?.clear();
  }
}

async function loadPreferencesRow(userId: string) {
  const selectClause = ["user_id"]
    .concat(preferenceKeys.map((key) => preferenceDefinitions[key].column.name))
    .join(", ");

  const { data, error } = await supabase
    .from(PREFERENCES_TABLE)
    .select(selectClause)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    error,
    row: (data as UserPreferencesRow | null) ?? null,
  };
}

function getGuestPreferences(): UserPreferences {
  return createPreferenceValues((key, definition) => {
    const guestValue = definition.guestPersistence?.load();

    if (guestValue === null || guestValue === undefined) {
      return getDefaultPreferenceValue(key);
    }

    return normalizePreferenceValue(key, guestValue);
  });
}

function normalizePreferencesRow(row: UserPreferencesRow): UserPreferences {
  return createPreferenceValues((key, definition) =>
    normalizePreferenceValue(key, row[definition.column.name]));
}

function shouldPersistPreferenceDefault(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function buildMissingPreferenceDefaultsPatch(
  row: UserPreferencesRow,
): Partial<UserPreferencesRow> {
  const patch: Partial<UserPreferencesRow> = {};

  for (const key of preferenceKeys) {
    const definition = preferenceDefinitions[key];
    const rawValue = row[definition.column.name];

    if (!shouldPersistPreferenceDefault(rawValue)) {
      continue;
    }

    patch[definition.column.name] = copyPreferenceValue(
      key,
      getDefaultPreferenceValue(key),
    );
  }

  return patch;
}

export function useUserPreferences(): UserPreferencesState {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(() =>
    getBootstrappedPreferences());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const userId = user?.id ?? null;
  const preferencesRef = useRef<UserPreferences>(preferences);
  const confirmedPreferencesRef = useRef<UserPreferences>(preferences);
  const activeUserIdRef = useRef<string | null>(userId);
  const queuedPreferenceSavesRef = useRef<QueuedPreferenceSaves>({});
  const savingPreferenceKeysRef = useRef(
    createPreferenceKeyRecord(() => false),
  );
  const saveGenerationRef = useRef(0);

  const resetPendingPreferenceSaves = useCallback(() => {
    saveGenerationRef.current += 1;
    queuedPreferenceSavesRef.current = {};
    savingPreferenceKeysRef.current = createPreferenceKeyRecord(() => false);
  }, []);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    activeUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    applySiteColor(preferences.siteColor);
  }, [preferences.siteColor]);

  useEffect(() => {
    let isActive = true;

    async function initializeSession() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const sessionUser = data.session?.user ?? null;

      if (!isActive) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
      }

      if (!sessionUser) {
        resetPendingPreferenceSaves();
        clearCachedPreferences();
        const guestPreferences = getGuestPreferences();
        confirmedPreferencesRef.current = guestPreferences;
        setPreferences(guestPreferences);
      }

      setUser(sessionUser);
      setSessionResolved(true);
    }

    void initializeSession();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((
      _event,
      session,
    ) => {
      const nextUser = session?.user ?? null;
      resetPendingPreferenceSaves();

      if (!nextUser) {
        clearCachedPreferences();
        const guestPreferences = getGuestPreferences();
        confirmedPreferencesRef.current = guestPreferences;
        setPreferences(guestPreferences);
      }

      setUser(nextUser);
    });

    return () => {
      isActive = false;
      authSubscription.subscription.unsubscribe();
    };
  }, [resetPendingPreferenceSaves]);

  useEffect(() => {
    if (!sessionResolved) {
      return;
    }

    let cancelled = false;

    async function syncPreferencesWithUser() {
      setError(null);
      setLoading(true);

      if (!userId) {
        resetPendingPreferenceSaves();
        clearCachedPreferences();
        const guestPreferences = getGuestPreferences();
        confirmedPreferencesRef.current = guestPreferences;
        setPreferences(guestPreferences);
        setSyncing(false);
        setLoading(false);
        return;
      }

      setSyncing(true);

      const { row, error: loadError } = await loadPreferencesRow(userId);

      if (cancelled) {
        return;
      }

      if (loadError) {
        setError(loadError.message);
        setSyncing(false);
        setLoading(false);
        return;
      }

      if (!row) {
        setError("Missing user preferences row.");
        setSyncing(false);
        setLoading(false);
        return;
      }

      const defaultPatch = buildMissingPreferenceDefaultsPatch(row);
      const hasMissingPreferenceDefaults = Object.keys(defaultPatch).length > 0;
      let nextRow = row;

      if (hasMissingPreferenceDefaults) {
        const { error: defaultsError } = await supabase
          .from(PREFERENCES_TABLE)
          .upsert(
            {
              user_id: userId,
              ...defaultPatch,
            },
            { onConflict: "user_id" },
          );

        if (cancelled) {
          return;
        }

        if (defaultsError) {
          setError(defaultsError.message);
        } else {
          nextRow = {
            ...row,
            ...defaultPatch,
          };
        }
      }

      const normalizedPreferences = normalizePreferencesRow(nextRow);
      saveCachedPreferences(normalizedPreferences);
      confirmedPreferencesRef.current = normalizedPreferences;
      setPreferences(normalizedPreferences);
      setSyncing(false);
      setLoading(false);
    }

    void syncPreferencesWithUser();

    return () => {
      cancelled = true;
    };
  }, [resetPendingPreferenceSaves, sessionResolved, user, userId]);

  const flushQueuedPreferenceSave = useCallback(async (key: PreferenceKey) => {
    const requestUserId = activeUserIdRef.current;

    if (!requestUserId || savingPreferenceKeysRef.current[key]) {
      return;
    }

    const generation = saveGenerationRef.current;
    savingPreferenceKeysRef.current[key] = true;

    try {
      while (true) {
        const queuedValue = queuedPreferenceSavesRef.current[key];

        if (queuedValue === undefined) {
          return;
        }

        delete queuedPreferenceSavesRef.current[key];

        const nextValue = copyPreferenceValue(
          key,
          queuedValue as UserPreferences[typeof key],
        );
        const definition = preferenceDefinitions[key];
        const { error: upsertError } = await supabase
          .from(PREFERENCES_TABLE)
          .upsert(
            {
              user_id: requestUserId,
              [definition.column.name]: copyPreferenceValue(key, nextValue),
            },
            { onConflict: "user_id" },
          );

        const becameStale =
          saveGenerationRef.current !== generation ||
          activeUserIdRef.current !== requestUserId;

        if (becameStale) {
          return;
        }

        if (upsertError) {
          setError(upsertError.message);

          if (queuedPreferenceSavesRef.current[key] !== undefined) {
            continue;
          }

          const currentValue = preferencesRef.current[key];

          if (arePreferenceValuesEqual(key, currentValue, nextValue)) {
            const confirmedValue = confirmedPreferencesRef.current[key];
            saveCachedPreference(key, confirmedValue);
            setPreferences((current) =>
              updatePreferenceValue(current, key, confirmedValue));
          }

          continue;
        }

        confirmedPreferencesRef.current = updatePreferenceValue(
          confirmedPreferencesRef.current,
          key,
          nextValue,
        );
      }
    } finally {
      if (
        saveGenerationRef.current === generation &&
        activeUserIdRef.current === requestUserId
      ) {
        savingPreferenceKeysRef.current[key] = false;

        if (queuedPreferenceSavesRef.current[key] !== undefined) {
          void flushQueuedPreferenceSave(key);
        }
      }
    }
  }, []);

  const savePreference = useCallback(
    async (key: PreferenceKey, nextInput: UserPreferences[PreferenceKey]) => {
      const definition = preferenceDefinitions[key];
      const normalized = normalizePreferenceValue(key, nextInput);
      setError(null);

      if (!userId) {
        const guestPersistence = definition.guestPersistence;
        const saveGuestPreference = guestPersistence?.save as
          | ((value: UserPreferences[typeof key]) => void)
          | undefined;

        if (!saveGuestPreference) {
          if (guestPersistence?.unsupportedMessage) {
            setError(guestPersistence.unsupportedMessage);
          }

          return false;
        }

        if (guestPersistence?.unsupportedMessage) {
          setError(guestPersistence.unsupportedMessage);
          return false;
        }

        saveGuestPreference(copyPreferenceValue(key, normalized));
        const nextPreferences = updatePreferenceValue(
          preferencesRef.current,
          key,
          normalized,
        );
        confirmedPreferencesRef.current = nextPreferences;
        setPreferences(nextPreferences);
        return true;
      }

      saveCachedPreference(key, normalized);
      queuedPreferenceSavesRef.current[key] = copyPreferenceValue(
        key,
        normalized,
      ) as never;
      setPreferences((current) =>
        updatePreferenceValue(current, key, normalized));

      void flushQueuedPreferenceSave(key);

      return true;
    },
    [flushQueuedPreferenceSave, userId],
  ) as SavePreference;

  const saveSources = useCallback(
    async (sources: readonly RatingSource[]) =>
      savePreference("ratingSources", [...sources]),
    [savePreference],
  );

  const saveLocation = useCallback(
    async (location: AppLocation) => savePreference("location", location),
    [savePreference],
  );

  const saveSiteColor = useCallback(
    async (siteColor: SiteColor) => savePreference("siteColor", siteColor),
    [savePreference],
  );

  const resetSiteColor = useCallback(
    async () => savePreference("siteColor", DEFAULT_SITE_COLOR),
    [savePreference],
  );

  return {
    user,
    preferences,
    preferenceOptions,
    sources: preferences.ratingSources,
    allSources: preferenceOptions.ratingSources ?? [],
    location: preferences.location,
    allLocations: preferenceOptions.location ?? [],
    allSiteColors: preferenceOptions.siteColor ?? [],
    siteColor: preferences.siteColor,
    defaultSiteColor: DEFAULT_SITE_COLOR,
    loading,
    syncing,
    error,
    savePreference,
    saveSources,
    saveLocation,
    saveSiteColor,
    resetSiteColor,
    setLocationPreference: saveLocation,
  };
}

export function useUserPreferencesContext(): UserPreferencesContextValue {
  return useContext(UserPreferencesContext) ?? fallbackValue;
}
