type BackdropRequest = {
  image: HTMLImageElement | null;
  ready: Promise<void>;
  failed: boolean;
};

/** Share the speculative download budget across all mounted scrollers. */
export function createBackdropPreloader() {
  const posterSources = new Set<string>();
  const criticalLoads = new Set<symbol>();
  const queued = new Map<string, Set<symbol>>();
  const requests = new Map<string, BackdropRequest>();
  let activeBackgroundRequests = 0;
  let drainTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const request = (src: string, priority: "high" | "low"): Promise<void> => {
    let existing = requests.get(src);
    if (priority === "high" && existing?.failed) {
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
    if (image.complete) {
      record.failed = image.naturalWidth === 0;
      finish();
    }
    return ready;
  };

  const scheduleDrain = () => {
    if (drainTimer !== null || queued.size === 0) return;
    // Let the rest of this React commit register critical poster work first.
    drainTimer = globalThis.setTimeout(() => {
      drainTimer = null;
      if (criticalLoads.size > 0) return;
      for (const src of queued.keys()) {
        if (activeBackgroundRequests >= 2) break;
        queued.delete(src);
        if (posterSources.has(src) || requests.has(src)) continue;
        activeBackgroundRequests += 1;
        void request(src, "low").then(() => {
          activeBackgroundRequests -= 1;
          scheduleDrain();
        });
      }
    }, 0);
  };

  return {
    protectPosters(sources: readonly string[], ready: Promise<unknown>) {
      for (const src of sources) {
        if (src) {
          posterSources.add(src);
          const existing = requests.get(src);
          if (existing?.image) existing.image.fetchPriority = "high";
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
      const owner = Symbol();
      for (const src of sources) {
        if (!src || posterSources.has(src) || requests.has(src)) continue;
        const owners = queued.get(src) ?? new Set<symbol>();
        owners.add(owner);
        queued.set(src, owners);
      }
      scheduleDrain();
      return () => {
        for (const [src, owners] of queued) {
          owners.delete(owner);
          if (owners.size === 0) queued.delete(src);
        }
      };
    },
    requestBackdropNow(src: string) {
      if (!src) return;
      queued.delete(src);
      void request(src, "high");
    },
  };
}

export const backdropPreloader = createBackdropPreloader();
