import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "../lib/supabase";
import {
  locationPreferenceDefinition,
  type AppLocation,
} from "./definitions/locations";
import {
  ratingSourcesPreferenceDefinition,
  type RatingSource,
} from "./definitions/ratingSources";
import {
  DEFAULT_SITE_COLOR,
  applySiteColor,
  siteColorPreferenceDefinition,
  type SiteColor,
} from "./definitions/siteColor";
import type { UserPreferenceDefinition } from "./definitions/shared";

const PREFERENCES_TABLE = "user_preferences";
const supabase = getSupabaseBrowserClient();

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

export type UserPreferencesState = {
  user: User | null;
  preferences: UserPreferences;
  preferenceOptions: UserPreferenceOptions;
  sources: RatingSource[];
  allSources: readonly RatingSource[];
  location: AppLocation;
  allLocations: readonly AppLocation[];
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
  getDefaultPreferenceValue(key),
);
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

async function loadPreferencesRow(
  userId: string,
) {
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

function buildCreatePayload(
  userId: string,
  user: User | null,
) {
  const values = {} as UserPreferences;
  const payload: UserPreferencesRow = { user_id: userId };

  for (const key of preferenceKeys) {
    const definition = preferenceDefinitions[key];
    const initialValue = normalizePreferenceValue(
      key,
      definition.getInitialValue?.({ user }) ?? definition.defaultValue,
    );

    values[key] = copyPreferenceValue(key, initialValue) as never;
    payload[definition.column.name] = copyPreferenceValue(key, initialValue);
  }

  return { payload, values };
}

async function createPreferencesRow(
  userId: string,
  user: User | null,
) {
  const { payload, values } = buildCreatePayload(userId, user);
  const { error } = await supabase
    .from(PREFERENCES_TABLE)
    .upsert(payload, { onConflict: "user_id" });

  return { error, values: error ? null : values };
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

function normalizePreferencesRow(
  row: UserPreferencesRow,
): UserPreferences {
  return createPreferenceValues((key, definition) =>
    normalizePreferenceValue(key, row[definition.column.name]),
  );
}

export function useUserPreferences(): UserPreferencesState {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(
    defaultPreferences,
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const userId = user?.id ?? null;
  const preferencesRef = useRef<UserPreferences>(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    applySiteColor(preferences.siteColor);
  }, [preferences.siteColor]);

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

    const { data: authSubscription } = supabase.auth.onAuthStateChange((
      _event,
      session,
    ) => {
      setUser(session?.user ?? null);
    });

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
        setPreferences(getGuestPreferences());
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
        const { values, error: createError } = await createPreferencesRow(
          userId,
          user,
        );

        if (cancelled) {
          return;
        }

        if (createError || !values) {
          setError(createError?.message ?? "Unable to initialize preferences.");
          setSyncing(false);
          setLoading(false);
          return;
        }

        setPreferences(values);
        setSyncing(false);
        setLoading(false);
        return;
      }

      setPreferences(normalizePreferencesRow(row));
      setSyncing(false);
      setLoading(false);
    }

    void syncPreferencesWithUser();

    return () => {
      cancelled = true;
    };
  }, [sessionResolved, user, userId]);

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
        setPreferences((current) => updatePreferenceValue(current, key, normalized));
        return true;
      }

      const previous = preferencesRef.current[key];
      setSyncing(true);
      setPreferences((current) => updatePreferenceValue(current, key, normalized));

      const { error: upsertError } = await supabase
        .from(PREFERENCES_TABLE)
        .upsert(
          {
            user_id: userId,
            [definition.column.name]: copyPreferenceValue(key, normalized),
          },
          { onConflict: "user_id" },
        );

      setSyncing(false);

      if (upsertError) {
        setError(upsertError.message);

        setPreferences((current) => updatePreferenceValue(current, key, previous));
        return false;
      }

      return true;
    },
    [userId],
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
