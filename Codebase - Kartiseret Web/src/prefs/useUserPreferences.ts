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
import type { UserPreferenceDefinition } from "./definitions/shared";

const PREFERENCES_TABLE = "user_preferences";
const supabase = getSupabaseBrowserClient();

const preferenceDefinitions = {
  ratingSources: ratingSourcesPreferenceDefinition,
  location: locationPreferenceDefinition,
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
type PreferenceColumnAvailability = Partial<Record<PreferenceKey, boolean>>;
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
  loading: boolean;
  syncing: boolean;
  error: string | null;
  savePreference: SavePreference;
  saveSources: (sources: readonly RatingSource[]) => Promise<boolean>;
  saveLocation: (location: AppLocation) => Promise<boolean>;
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
  loading: false,
  syncing: false,
  error: null,
  savePreference: fallbackSavePreference,
  saveSources: async () => false,
  saveLocation: async () => false,
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

function getPersistedPreferenceKeys(
  columnAvailability: PreferenceColumnAvailability,
): PreferenceKey[] {
  return preferenceKeys.filter((key) => {
    const column = preferenceDefinitions[key].column;

    return !column.optional || columnAvailability[key] !== false;
  });
}

function findMissingOptionalPreferenceKey(
  error: unknown,
  selectedKeys: readonly PreferenceKey[],
): PreferenceKey | null {
  for (const key of selectedKeys) {
    const column = preferenceDefinitions[key].column;

    if (column.optional && isMissingColumnError(error, column.name)) {
      return key;
    }
  }

  return null;
}

async function loadPreferencesRow(
  userId: string,
  columnAvailability: PreferenceColumnAvailability,
) {
  while (true) {
    const selectedKeys = getPersistedPreferenceKeys(columnAvailability);
    const selectClause = ["user_id"]
      .concat(selectedKeys.map((key) => preferenceDefinitions[key].column.name))
      .join(", ");

    const { data, error } = await supabase
      .from(PREFERENCES_TABLE)
      .select(selectClause)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error) {
      for (const key of selectedKeys) {
        if (preferenceDefinitions[key].column.optional) {
          columnAvailability[key] = true;
        }
      }

      return {
        error: null,
        row: (data as UserPreferencesRow | null) ?? null,
      };
    }

    const missingKey = findMissingOptionalPreferenceKey(error, selectedKeys);

    if (!missingKey) {
      return { error, row: null };
    }

    columnAvailability[missingKey] = false;
  }
}

function buildCreatePayload(
  userId: string,
  user: User | null,
  columnAvailability: PreferenceColumnAvailability,
) {
  const selectedKeys = getPersistedPreferenceKeys(columnAvailability);
  const values = {} as UserPreferences;
  const payload: UserPreferencesRow = { user_id: userId };

  for (const key of preferenceKeys) {
    const definition = preferenceDefinitions[key];
    const canPersist = selectedKeys.includes(key);
    const initialValue = canPersist
      ? normalizePreferenceValue(
          key,
          definition.getInitialValue?.({ user }) ?? definition.defaultValue,
        )
      : getDefaultPreferenceValue(key);

    values[key] = copyPreferenceValue(key, initialValue) as never;

    if (canPersist) {
      payload[definition.column.name] = copyPreferenceValue(key, initialValue);
    }
  }

  return { payload, selectedKeys, values };
}

async function createPreferencesRow(
  userId: string,
  user: User | null,
  columnAvailability: PreferenceColumnAvailability,
) {
  while (true) {
    const { payload, selectedKeys, values } = buildCreatePayload(
      userId,
      user,
      columnAvailability,
    );

    const { error } = await supabase
      .from(PREFERENCES_TABLE)
      .upsert(payload, { onConflict: "user_id" });

    if (!error) {
      for (const key of selectedKeys) {
        if (preferenceDefinitions[key].column.optional) {
          columnAvailability[key] = true;
        }
      }

      return { error: null, values };
    }

    const missingKey = findMissingOptionalPreferenceKey(error, selectedKeys);

    if (!missingKey) {
      return { error, values: null };
    }

    columnAvailability[missingKey] = false;
  }
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
  columnAvailability: PreferenceColumnAvailability,
): UserPreferences {
  return createPreferenceValues((key, definition) => {
    if (definition.column.optional && columnAvailability[key] === false) {
      return getDefaultPreferenceValue(key);
    }

    return normalizePreferenceValue(key, row[definition.column.name]);
  });
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
  const columnAvailabilityRef = useRef<PreferenceColumnAvailability>({});

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

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

      const { row, error: loadError } = await loadPreferencesRow(
        userId,
        columnAvailabilityRef.current,
      );

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
          columnAvailabilityRef.current,
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

      setPreferences(
        normalizePreferencesRow(row, columnAvailabilityRef.current),
      );
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

        if (guestPersistence?.unsupportedMessage) {
          setError(guestPersistence.unsupportedMessage);
          return false;
        }

        saveGuestPreference?.(copyPreferenceValue(key, normalized));
        setPreferences((current) => updatePreferenceValue(current, key, normalized));
        return true;
      }

      if (definition.column.optional && columnAvailabilityRef.current[key] === false) {
        setError(definition.column.missingColumnMessage);
        return false;
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
        if (
          definition.column.optional &&
          isMissingColumnError(upsertError, definition.column.name)
        ) {
          columnAvailabilityRef.current[key] = false;
          setError(definition.column.missingColumnMessage);
        } else {
          setError(upsertError.message);
        }

        setPreferences((current) => updatePreferenceValue(current, key, previous));
        return false;
      }

      if (definition.column.optional) {
        columnAvailabilityRef.current[key] = true;
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

  return {
    user,
    preferences,
    preferenceOptions,
    sources: preferences.ratingSources,
    allSources: preferenceOptions.ratingSources ?? [],
    location: preferences.location,
    allLocations: preferenceOptions.location ?? [],
    loading,
    syncing,
    error,
    savePreference,
    saveSources,
    saveLocation,
    setLocationPreference: saveLocation,
  };
}

export function useUserPreferencesContext(): UserPreferencesContextValue {
  return useContext(UserPreferencesContext) ?? fallbackValue;
}
