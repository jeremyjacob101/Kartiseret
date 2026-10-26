type BackdropRequest = {
  image: HTMLImageElement | null;
  ready: Promise<void>;
  failed: boolean;
};

type QueuedImage = {
  posters: Set<symbol>;
  backdrops: Set<symbol>;
};

/** Share the speculative download budget across all mounted scrollers. */
export function createBackdropPreloader() {
  const posterSources = new Set<string>();
  const criticalLoads = new Set<symbol>();
  const queued = new Map<string, QueuedImage>();
  const requests = new Map<string, BackdropRequest>();
  const listeners = new Set<() => void>();
  const afterPosters = new Map<symbol, () => void>();
  let startedPosters: ReadonlySet<string> = new Set();
  let activeBackgroundRequests = 0;
  let drainTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const markPosterStarted = (src: string) => {
    if (startedPosters.has(src)) return;
    startedPosters = new Set([...startedPosters, src]);
    for (const listener of listeners) listener();
  };

  const request = (
    src: string,
    priority: "high" | "low",
    retryFailed = false,
  ): Promise<void> => {
    let existing = requests.get(src);
    if (retryFailed && existing?.failed) {
      requests.delete(src);
      existing = undefined;
    }
    if (existing) {
      if (priority === "high" && existing.image)
        existing.image.fetchPriority = "high";
      return existing.ready;
    }

    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = priority;
    let resolve!: () => void;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    const record = {
      image: image as HTMLImageElement | null,
      ready,
      failed: false,
    };
    requests.set(src, record);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      // Keep request deduplication without retaining decoded backdrop images.
      record.image = null;
      resolve();
    };
    image.onload = finish;
    image.onerror = () => {
      record.failed = true;
      finish();
    };
    image.src = src;
    if (posterSources.has(src)) markPosterStarted(src);
    if (image.complete) {
      record.failed = image.naturalWidth === 0;
      finish();
    }
    return ready;
  };

  const scheduleDrain = () => {
    if (drainTimer !== null || (queued.size === 0 && afterPosters.size === 0))
      return;
    // Let the rest of this React commit register critical poster work first.
    drainTimer = globalThis.setTimeout(() => {
      drainTimer = null;
      if (criticalLoads.size > 0) return;
      // Offscreen posters use the shared budget before speculative backdrops.
      for (const kind of ["posters", "backdrops"] as const) {
        for (const [src, owners] of queued) {
          if (criticalLoads.size > 0 || activeBackgroundRequests >= 2) break;
          if (owners[kind].size === 0) continue;
          if (kind === "backdrops" && owners.posters.size > 0) continue;
          queued.delete(src);
          if (
            requests.has(src) ||
            (kind === "backdrops" && posterSources.has(src))
          )
            continue;
          activeBackgroundRequests += 1;
          void request(src, "low").then(() => {
            activeBackgroundRequests -= 1;
            scheduleDrain();
          });
        }
      }
      for (const [token, task] of afterPosters) {
        if (criticalLoads.size > 0) break;
        afterPosters.delete(token);
        task();
      }
    }, 0);
  };

  const warmImages = (sources: readonly string[], kind: keyof QueuedImage) => {
    const owner = Symbol();
    for (const src of sources) {
      if (!src) continue;
      if (kind === "posters") posterSources.add(src);
      if (requests.has(src) || (kind === "backdrops" && posterSources.has(src)))
        continue;
      const owners = queued.get(src) ?? {
        posters: new Set<symbol>(),
        backdrops: new Set<symbol>(),
      };
      owners[kind].add(owner);
      queued.set(src, owners);
    }
    scheduleDrain();
    return () => {
      for (const [src, owners] of queued) {
        owners[kind].delete(owner);
        if (owners.posters.size === 0 && owners.backdrops.size === 0)
          queued.delete(src);
      }
    };
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStartedPosters: () => startedPosters,
    requestPosterNow(src: string) {
      posterSources.add(src);
      queued.delete(src);
      const ready = request(src, "high");
      markPosterStarted(src);
      return ready;
    },
    warmPosters(sources: readonly string[]) {
      return warmImages(sources, "posters");
    },
    afterCriticalPosters(task: () => void) {
      const token = Symbol();
      afterPosters.set(token, task);
      scheduleDrain();
      return () => {
        afterPosters.delete(token);
      };
    },
    protectPosters(sources: readonly string[], ready: Promise<unknown>) {
      for (const src of sources) {
        if (src) {
          posterSources.add(src);
          const existing = requests.get(src);
          if (existing?.image && !startedPosters.has(src))
            existing.image.fetchPriority = "high";
          if (existing) markPosterStarted(src);
        }
      }
      const token = Symbol();
      criticalLoads.add(token);
      const release = () => {
        criticalLoads.delete(token);
        scheduleDrain();
      };
      void ready.then(release, release);
      return release;
    },
    warmBackdrops(sources: readonly string[]) {
      return warmImages(sources, "backdrops");
    },
    requestBackdropNow(src: string) {
      if (!src) return;
      queued.delete(src);
      void request(src, "high", true);
    },
  };
}

export const backdropPreloader = createBackdropPreloader();
