import { DEFAULT_SITE_COLOR, applySiteColor, initializeSiteColorTheme, siteColorPreferenceDefinition, type SiteColor, type SiteColorOption } from "../prefs/definitions/siteColor";
import { DEFAULT_LOCATION, loadGuestLocation, locationPreferenceDefinition, type AppLocation } from "../prefs/definitions/locations";
import { preferencesResponseSchema, applicationIdentitySchema, type ApplicationIdentity } from "@kartiseret/contracts/private-data";
import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ratingSourcesPreferenceDefinition, type RatingSource } from "../prefs/definitions/ratingSources";
import { hideReReleasesPreferenceDefinition } from "../prefs/definitions/hideReReleases";
import { showtimePreferencesDefinition } from "../prefs/definitions/showtimePreferences";
import { privateApiResponse, privateIdentityChanged } from "../data/privateApi";
import type { PrivatePageDisplay } from "@kartiseret/contracts/public-render";
import type { UserPreferenceDefinition } from "../prefs/definitions/shared";
import { shouldRollbackOptimisticSave } from "./preferenceSavePolicy";
import { getAuthClient } from "../lib/authClient";
import { create } from "zustand";

const authClient = getAuthClient();

initializeSiteColorTheme();

const preferenceDefinitions = {
  ratingSources: ratingSourcesPreferenceDefinition,
  location: locationPreferenceDefinition,
  siteColor: siteColorPreferenceDefinition,
  hideReReleases: hideReReleasesPreferenceDefinition,
  showtimePreferences: showtimePreferencesDefinition,
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

export type UserPreferences = {
  [Key in PreferenceKey]: PreferenceValue<PreferenceDefinitions[Key]>;
};

export type UserPreferenceOptions = {
  [Key in PreferenceKey]:
    readonly PreferenceOption<PreferenceDefinitions[Key]>[] | undefined;
};

type SavePreference = <Key extends PreferenceKey>(
  key: Key,
  value: UserPreferences[Key],
) => Promise<boolean>;

type QueuedPreferenceSaves = Partial<{
  [Key in PreferenceKey]: UserPreferences[Key];
}>;

export type UserPreferencesStoreState = {
  user: ApplicationIdentity | null;
  documentDisplay: PrivatePageDisplay | null;
  preferences: UserPreferences;
  preferenceOptions: UserPreferenceOptions;
  allSources: readonly RatingSource[];
  allLocations: readonly AppLocation[];
  allSiteColors: readonly SiteColorOption[];
  defaultSiteColor: SiteColor;
  loading: boolean;
  loadError: boolean;
  syncing: boolean;
  error: string | null;
  savePreference: SavePreference;
  saveSources: (sources: readonly RatingSource[]) => Promise<boolean>;
  saveLocation: (location: AppLocation) => Promise<boolean>;
  saveSiteColor: (siteColor: SiteColor) => Promise<boolean>;
  saveHideReReleases: (hide: boolean) => Promise<boolean>;
  saveShowtimePreferences: (
    preferences: UserPreferences["showtimePreferences"],
  ) => Promise<boolean>;
  resetSiteColor: () => Promise<boolean>;
  setLocationPreference: (location: AppLocation) => Promise<boolean>;
  retryPreferenceLoad: () => void;
};

const preferenceKeys = Object.keys(preferenceDefinitions) as PreferenceKey[];

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
  const parse = getPreferenceDefinition(key).parse as (
    value: unknown,
  ) => UserPreferences[Key];

  return parse(value);
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

  return JSON.stringify(leftCopy) === JSON.stringify(rightCopy);
}

function getBootstrappedPreferences(): UserPreferences {
  return createPreferenceValues((key) => {
    const cachedValue = getPreferenceDefinition(key).clientCache?.load();

    if (cachedValue === null || cachedValue === undefined) {
      const guestValue = getPreferenceDefinition(key).guestPersistence?.load();
      return guestValue == null
        ? getDefaultPreferenceValue(key)
        : normalizePreferenceValue(key, guestValue);
    }

    return normalizePreferenceValue(key, cachedValue);
  });
}

function saveCachedPreference<Key extends PreferenceKey>(
  key: Key,
  value: UserPreferences[Key],
): void {
  const save = getPreferenceDefinition(key).clientCache?.save as
    ((nextValue: UserPreferences[Key]) => void) | undefined;

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

function getGuestPreferences(): UserPreferences {
  return createPreferenceValues((key, definition) => {
    const guestValue = definition.guestPersistence?.load();

    if (guestValue === null || guestValue === undefined) {
      return getDefaultPreferenceValue(key);
    }

    return normalizePreferenceValue(key, guestValue);
  });
}

const preferenceOptions = createPreferenceOptions();
const initialPreferences = getBootstrappedPreferences();

let activeUserId: string | null = null;
let confirmedPreferences = initialPreferences;
let queuedPreferenceSaves: QueuedPreferenceSaves = {};
let savingPreferenceKeys = createPreferenceKeyRecord(() => false);
let saveGeneration = 0;
let preferenceSyncGeneration = 0;
let initializationStarted = false;
let disposeAuthSubscription: (() => void) | null = null;

function commitPreferences(preferences: UserPreferences): void {
  applySiteColor(preferences.siteColor);
  useUserPreferencesStore.setState({ preferences });
}

function resetPendingPreferenceSaves(): void {
  saveGeneration += 1;
  queuedPreferenceSaves = {};
  savingPreferenceKeys = createPreferenceKeyRecord(() => false);
}

async function flushQueuedPreferenceSave(key: PreferenceKey): Promise<void> {
  const requestUserId = activeUserId;

  if (!requestUserId || savingPreferenceKeys[key]) {
    return;
  }

  const generation = saveGeneration;
  savingPreferenceKeys[key] = true;

  try {
    while (true) {
      const queuedValue = queuedPreferenceSaves[key];

      if (queuedValue === undefined) {
        return;
      }

      delete queuedPreferenceSaves[key];

      const nextValue = copyPreferenceValue(
        key,
        queuedValue as UserPreferences[typeof key],
      );
      let upsertError: Error | null = null;
      try {
        await privateApiResponse(
          "/api/v1/preferences",
          preferencesResponseSchema,
          {
            method: "PATCH",
            userId: requestUserId,
            body: { [key]: copyPreferenceValue(key, nextValue) },
          },
        );
      } catch (error) {
        upsertError =
          error instanceof Error
            ? error
            : new Error("Could not save preferences.");
      }
      const becameStale =
        saveGeneration !== generation || activeUserId !== requestUserId;

      if (becameStale) {
        return;
      }

      if (upsertError) {
        useUserPreferencesStore.setState({ error: upsertError.message });
        const currentValue =
          useUserPreferencesStore.getState().preferences[key];

        if (
          shouldRollbackOptimisticSave({
            currentValue,
            failedValue: nextValue,
            hasQueuedSave: queuedPreferenceSaves[key] !== undefined,
            valuesEqual: (left, right) =>
              arePreferenceValuesEqual(key, left, right),
          })
        ) {
          const confirmedValue = confirmedPreferences[key];
          saveCachedPreference(key, confirmedValue);
          commitPreferences(
            updatePreferenceValue(
              useUserPreferencesStore.getState().preferences,
              key,
              confirmedValue,
            ),
          );
        }

        if (queuedPreferenceSaves[key] !== undefined) {
          continue;
        }

        continue;
      }

      confirmedPreferences = updatePreferenceValue(
        confirmedPreferences,
        key,
        nextValue,
      );
    }
  } finally {
    if (saveGeneration === generation && activeUserId === requestUserId) {
      savingPreferenceKeys[key] = false;

      if (queuedPreferenceSaves[key] !== undefined) {
        void flushQueuedPreferenceSave(key);
      }
    }
  }
}

async function savePreferenceValue<Key extends PreferenceKey>(
  key: Key,
  nextInput: UserPreferences[Key],
): Promise<boolean> {
  const definition = preferenceDefinitions[key];
  const normalized = normalizePreferenceValue(key, nextInput);
  const requestUserId = activeUserId;

  useUserPreferencesStore.setState({ error: null });

  if (!requestUserId) {
    const guestPersistence = definition.guestPersistence;
    const saveGuestPreference = guestPersistence?.save as
      ((value: UserPreferences[typeof key]) => void) | undefined;

    if (!saveGuestPreference || guestPersistence?.unsupportedMessage) {
      if (guestPersistence?.unsupportedMessage) {
        useUserPreferencesStore.setState({
          error: guestPersistence.unsupportedMessage,
        });
      }

      return false;
    }

    saveGuestPreference(copyPreferenceValue(key, normalized));
    const nextPreferences = updatePreferenceValue(
      useUserPreferencesStore.getState().preferences,
      key,
      normalized,
    );
    confirmedPreferences = nextPreferences;
    commitPreferences(nextPreferences);
    return true;
  }

  saveCachedPreference(key, normalized);
  queuedPreferenceSaves[key] = copyPreferenceValue(key, normalized) as never;
  commitPreferences(
    updatePreferenceValue(
      useUserPreferencesStore.getState().preferences,
      key,
      normalized,
    ),
  );
  void flushQueuedPreferenceSave(key);

  return true;
}

const userPreferencesStore = create<UserPreferencesStoreState>()(() => ({
  user: null,
  documentDisplay: null,
  preferences: initialPreferences,
  preferenceOptions,
  allSources: preferenceOptions.ratingSources ?? [],
  allLocations: preferenceOptions.location ?? [],
  allSiteColors: preferenceOptions.siteColor ?? [],
  defaultSiteColor: DEFAULT_SITE_COLOR,
  loading: true,
  loadError: false,
  syncing: false,
  error: null,
  savePreference: savePreferenceValue as SavePreference,
  saveSources: (sources) => savePreferenceValue("ratingSources", [...sources]),
  saveLocation: (location) => savePreferenceValue("location", location),
  saveSiteColor: (siteColor) => savePreferenceValue("siteColor", siteColor),
  saveHideReReleases: (hide) => savePreferenceValue("hideReReleases", hide),
  saveShowtimePreferences: (preferences) =>
    savePreferenceValue("showtimePreferences", preferences),
  resetSiteColor: () => savePreferenceValue("siteColor", DEFAULT_SITE_COLOR),
  setLocationPreference: (location) =>
    savePreferenceValue("location", location),
  retryPreferenceLoad: () => {
    void syncPreferencesWithUser(activeUserId);
  },
}));

const publicPreferenceSnapshotContext =
  createContext<UserPreferencesStoreState | null>(null);

type UserPreferencesSelector<Selected> = (
  state: UserPreferencesStoreState,
) => Selected;

function useUserPreferencesStoreHook<Selected = UserPreferencesStoreState>(
  selector: UserPreferencesSelector<Selected> = ((state) =>
    state as Selected) as UserPreferencesSelector<Selected>,
): Selected {
  const publicSnapshot = useContext(publicPreferenceSnapshotContext);
  return useSyncExternalStore(
    userPreferencesStore.subscribe,
    () => selector(publicSnapshot ?? userPreferencesStore.getState()),
    () => selector(publicSnapshot ?? userPreferencesStore.getInitialState()),
  );
}

export const useUserPreferencesStore = Object.assign(
  useUserPreferencesStoreHook,
  userPreferencesStore,
);

export function PublicPreferencesSnapshotProvider({
  snapshot,
  children,
}: {
  snapshot: UserPreferencesStoreState;
  children: ReactNode;
}) {
  const [hydrating, setHydrating] = useState(true);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHydrating(false));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return createElement(
    publicPreferenceSnapshotContext.Provider,
    { value: hydrating ? snapshot : null },
    children,
  );
}

/** Create non-personalized public defaults without mutating the shared client store. */
export function preparePublicPagePreferenceState(
  display?: PrivatePageDisplay,
): UserPreferencesStoreState {
  const publicPreferences = createPreferenceValues((key, definition) =>
    normalizePreferenceValue(key, definition.defaultValue));
  return {
    ...userPreferencesStore.getInitialState(),
    user: null,
    documentDisplay: display ?? null,
    preferences: display?.preferences ?? publicPreferences,
    preferenceOptions,
    allSources: preferenceOptions.ratingSources ?? [],
    allLocations: preferenceOptions.location ?? [],
    allSiteColors: preferenceOptions.siteColor ?? [],
    defaultSiteColor: DEFAULT_SITE_COLOR,
    loading: false,
    loadError: false,
    syncing: false,
    error: null,
  };
}

function isCurrentPreferenceSync(
  generation: number,
  userId: string | null,
): boolean {
  return generation === preferenceSyncGeneration && userId === activeUserId;
}

async function syncPreferencesWithUser(userId: string | null): Promise<void> {
  const generation = ++preferenceSyncGeneration;

  useUserPreferencesStore.setState({
    error: null,
    loading: true,
    loadError: false,
  });

  if (!userId) {
    clearCachedPreferences();
    const guestPreferences = getGuestPreferences();
    confirmedPreferences = guestPreferences;
    commitPreferences(guestPreferences);
    useUserPreferencesStore.setState({
      syncing: false,
      loading: false,
      loadError: false,
    });
    return;
  }

  useUserPreferencesStore.setState({ syncing: true });
  try {
    const response = await privateApiResponse(
      "/api/v1/preferences/initialize",
      preferencesResponseSchema,
      {
        method: "POST",
        userId,
        body: { fallbackLocation: loadGuestLocation() ?? DEFAULT_LOCATION },
      },
    );
    if (!isCurrentPreferenceSync(generation, userId)) return;
    const normalizedPreferences = response.data;
    saveCachedPreferences(normalizedPreferences);
    confirmedPreferences = normalizedPreferences;
    commitPreferences(normalizedPreferences);
    useUserPreferencesStore.setState({
      syncing: false,
      loading: false,
      loadError: false,
    });
  } catch (error) {
    if (!isCurrentPreferenceSync(generation, userId)) return;
    useUserPreferencesStore.setState({
      error:
        error instanceof Error ? error.message : "Could not load preferences.",
      syncing: false,
      loading: false,
      loadError: true,
    });
  }
}

function activateUser(
  nextUser: ApplicationIdentity | null,
  forceSync = false,
  keepDocumentDisplay = false,
): void {
  const nextUserId = nextUser?.id ?? null;
  const didIdentityChange = nextUserId !== activeUserId;

  useUserPreferencesStore.setState({ user: nextUser });

  if (!didIdentityChange && !forceSync) {
    return;
  }

  if (!keepDocumentDisplay && (didIdentityChange || forceSync)) {
    useUserPreferencesStore.setState({ documentDisplay: null });
    clearCachedPreferences();
    const initial = getGuestPreferences();
    confirmedPreferences = initial;
    commitPreferences(initial);
  }
  activeUserId = nextUserId;
  privateIdentityChanged(nextUserId);
  resetPendingPreferenceSaves();
  void syncPreferencesWithUser(nextUserId);
}

function parseAuthUser(value: unknown): ApplicationIdentity | null {
  if (value === null || value === undefined) {
    return null;
  }

  const result = applicationIdentitySchema.safeParse(value);
  return result.success
    ? { id: result.data.id, email: result.data.email ?? null }
    : null;
}

export function initializeUserPreferencesStore(
  display?: PrivatePageDisplay,
): void {
  if (initializationStarted) {
    return;
  }

  initializationStarted = true;
  useUserPreferencesStore.setState({ documentDisplay: display ?? null });
  confirmedPreferences = display?.preferences ?? getBootstrappedPreferences();
  commitPreferences(confirmedPreferences);

  let receivedSession = false;
  let sessionGeneration = 0;
  disposeAuthSubscription = authClient.useSession.subscribe(({
    data,
    error,
    isPending,
  }) => {
    if (isPending) return;
    const generation = ++sessionGeneration;
    if (error && error.status !== 401) {
      useUserPreferencesStore.setState({
        error: error.message,
        loading: false,
        loadError: true,
      });
      return;
    }
    const user = error ? null : parseAuthUser(data?.user);
    const snapshot = useUserPreferencesStore.getState().documentDisplay;
    const finish = (keep: boolean) => {
      if (generation !== sessionGeneration) return;
      activateUser(user, !receivedSession, keep);
      receivedSession = true;
    };
    if (!user || !snapshot) {
      finish(false);
      return;
    }
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(user.id))
      .then(
        (value) => {
          const key = Array.from(new Uint8Array(value), (byte) =>
            byte.toString(16).padStart(2, "0")).join("");
          finish(key === snapshot.accountKey);
        },
        () => finish(false),
      );
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeAuthSubscription?.();
    disposeAuthSubscription = null;
    initializationStarted = false;
    preferenceSyncGeneration += 1;
  });
}
