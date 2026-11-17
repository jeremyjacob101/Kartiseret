import { AsyncLocalStorage } from "node:async_hooks";
import { recordPreparationCacheMetric } from "../catalog-timing.js";
import type { PublicDataSnapshotMetadata } from "./repository.js";

type CacheResult = object;
type CacheContext = {
  repository: object;
  revision: string;
  rankingDate: string;
  pending: Map<string, PendingCandidate>;
  finished: boolean;
};
type CacheEntry = {
  value: CacheResult;
  bytes: number;
};
type CacheFlight = {
  owner: CacheContext;
  promise: Promise<CacheResult | undefined>;
  resolve: (value: CacheResult | undefined) => void;
};
type PendingCandidate = {
  key: string;
  cache: RepositoryCache;
  flight: CacheFlight;
  value: CacheResult;
  bytes: number;
  retain: boolean;
};
type RepositoryCache = {
  entries: Map<string, CacheEntry>;
  flights: Map<string, CacheFlight>;
  bytes: number;
  pendingBytes: number;
};

const MAX_ENTRIES_PER_REPOSITORY = 128;
const MAX_BYTES_PER_REPOSITORY = 16 * 1024 * 1024;
const MAX_IN_FLIGHT_PER_REPOSITORY = 128;
const snapshotContext = new AsyncLocalStorage<CacheContext>();
const repositoryCaches = new WeakMap<object, RepositoryCache>();

function getRepositoryCache(repository: object): RepositoryCache {
  const existing = repositoryCaches.get(repository);
  if (existing) return existing;
  const created: RepositoryCache = {
    entries: new Map(),
    flights: new Map(),
    bytes: 0,
    pendingBytes: 0,
  };
  repositoryCaches.set(repository, created);
  return created;
}

function jsonClone<T extends CacheResult>(value: T): T {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string")
    throw new TypeError("Prepared public data is not JSON serializable.");
  return JSON.parse(serialized) as T;
}

function jsonCloneWithSize<T extends CacheResult>(
  value: T,
): {
  value: T;
  bytes: number;
} {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string")
    throw new TypeError("Prepared public data is not JSON serializable.");
  return {
    value: JSON.parse(serialized) as T,
    bytes: Buffer.byteLength(serialized),
  };
}

function cacheKey(
  context: CacheContext,
  operation: string,
  arguments_: readonly (string | number | null)[],
): string {
  return JSON.stringify([
    operation,
    context.revision,
    context.rankingDate,
    ...arguments_,
  ]);
}

function remember(cache: RepositoryCache, key: string, entry: CacheEntry) {
  const previous = cache.entries.get(key);
  if (previous) {
    cache.bytes -= previous.bytes;
    cache.entries.delete(key);
  }
  while (
    cache.entries.size >= MAX_ENTRIES_PER_REPOSITORY ||
    cache.bytes + entry.bytes > MAX_BYTES_PER_REPOSITORY
  ) {
    const oldestKey = cache.entries.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    const oldest = cache.entries.get(oldestKey);
    if (oldest) cache.bytes -= oldest.bytes;
    cache.entries.delete(oldestKey);
  }
  cache.entries.set(key, entry);
  cache.bytes += entry.bytes;
}

function resolveFlight(
  candidate: PendingCandidate,
  value: CacheResult | undefined,
) {
  candidate.cache.pendingBytes -= candidate.retain ? candidate.bytes : 0;
  if (candidate.cache.flights.get(candidate.key) === candidate.flight)
    candidate.cache.flights.delete(candidate.key);
  candidate.flight.resolve(value);
}

export function hasPublicDataPreparationSnapshot(repository: object): boolean {
  return snapshotContext.getStore()?.repository === repository;
}

export function createPublicDataPreparationSnapshot(
  repository: object,
  revision: string,
  metadata: PublicDataSnapshotMetadata,
): {
  run<T>(operation: () => Promise<T>): Promise<T>;
  commit(): void;
  discard(): void;
} {
  const parent = snapshotContext.getStore();
  const context: CacheContext = {
    repository,
    revision,
    rankingDate: metadata.rankingDate,
    pending: new Map(),
    finished: false,
  };
  function finishFlights() {
    const cache = getRepositoryCache(repository);
    for (const [key, flight] of cache.flights) {
      if (flight.owner !== context) continue;
      cache.flights.delete(key);
      flight.resolve(undefined);
    }
    context.pending.clear();
  }
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      return parent?.repository === repository
        ? operation()
        : snapshotContext.run(context, operation);
    },
    commit() {
      if (context.finished) return;
      context.finished = true;
      for (const candidate of context.pending.values()) {
        if (candidate.retain)
          remember(candidate.cache, candidate.key, {
            value: candidate.value,
            bytes: candidate.bytes,
          });
        resolveFlight(
          candidate,
          candidate.retain ? candidate.value : undefined,
        );
      }
      finishFlights();
    },
    discard() {
      if (context.finished) return;
      context.finished = true;
      for (const candidate of context.pending.values())
        resolveFlight(candidate, undefined);
      finishFlights();
    },
  };
}

export async function getPreparedPublicData<T extends CacheResult>(
  repository: object,
  operation: string,
  arguments_: readonly (string | number | null)[],
  prepare: () => Promise<T>,
  retainWhen: (value: T) => boolean = () => true,
): Promise<T> {
  const context = snapshotContext.getStore();
  if (!context || context.finished || context.repository !== repository)
    return prepare();

  const cache = getRepositoryCache(repository);
  const key = cacheKey(context, operation, arguments_);
  const cached = cache.entries.get(key);
  if (cached) {
    cache.entries.delete(key);
    cache.entries.set(key, cached);
    const started = performance.now();
    const result = jsonClone(cached.value) as T;
    recordPreparationCacheMetric(operation, "hit", {
      copyMs: performance.now() - started,
    });
    return result;
  }

  const pending = context.pending.get(key);
  if (pending?.retain) {
    const started = performance.now();
    const result = jsonClone(pending.value) as T;
    recordPreparationCacheMetric(operation, "hit", {
      copyMs: performance.now() - started,
    });
    return result;
  }

  const flight = cache.flights.get(key);
  // A snapshot already owning work must not wait for another snapshot's
  // commit: opposite acquisition orders can create a circular wait.
  if (
    flight &&
    (flight.owner === context ||
      [...cache.flights.values()].some((active) => active.owner === context))
  ) {
    const started = performance.now();
    const result = await prepare();
    recordPreparationCacheMetric(operation, "bypass", {
      buildMs: performance.now() - started,
    });
    return result;
  }
  if (flight && flight.owner !== context) {
    const waitStarted = performance.now();
    const shared = await flight.promise;
    if (shared) {
      const copyStarted = performance.now();
      const result = jsonClone(shared) as T;
      recordPreparationCacheMetric(operation, "wait", {
        waitMs: performance.now() - waitStarted,
        copyMs: performance.now() - copyStarted,
      });
      return result;
    }
    return getPreparedPublicData(
      repository,
      operation,
      arguments_,
      prepare,
      retainWhen,
    );
  }

  if (cache.flights.size >= MAX_IN_FLIGHT_PER_REPOSITORY) {
    const started = performance.now();
    const result = await prepare();
    recordPreparationCacheMetric(operation, "bypass", {
      buildMs: performance.now() - started,
    });
    return result;
  }

  let resolve!: (value: CacheResult | undefined) => void;
  const promise = new Promise<CacheResult | undefined>((done) => {
    resolve = done;
  });
  const createdFlight: CacheFlight = { owner: context, promise, resolve };
  cache.flights.set(key, createdFlight);
  const started = performance.now();
  try {
    const result = await prepare();
    const buildMs = performance.now() - started;
    let value: CacheResult | undefined;
    let bytes = 0;
    let retain = false;
    let copyMs = 0;
    if (retainWhen(result)) {
      const copyStarted = performance.now();
      try {
        const cloned = jsonCloneWithSize(result);
        value = cloned.value;
        bytes = cloned.bytes;
        retain =
          Number.isFinite(bytes) &&
          bytes > 0 &&
          bytes <= MAX_BYTES_PER_REPOSITORY &&
          cache.pendingBytes + bytes <= MAX_BYTES_PER_REPOSITORY;
      } catch {
        value = undefined;
      } finally {
        copyMs = performance.now() - copyStarted;
      }
    }
    recordPreparationCacheMetric(operation, "miss", { buildMs, copyMs });
    if (
      !value ||
      !retain ||
      context.finished ||
      cache.flights.get(key) !== createdFlight
    ) {
      if (cache.flights.get(key) === createdFlight) cache.flights.delete(key);
      createdFlight.resolve(undefined);
      return result;
    }

    if (retain) cache.pendingBytes += bytes;
    context.pending.set(key, {
      key,
      cache,
      flight: createdFlight,
      value,
      bytes,
      retain,
    });
    return result;
  } catch (error) {
    if (cache.flights.get(key) === createdFlight) cache.flights.delete(key);
    createdFlight.resolve(undefined);
    throw error;
  }
}
