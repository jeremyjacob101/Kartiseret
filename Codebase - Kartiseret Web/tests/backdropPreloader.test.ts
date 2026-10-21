import { createBackdropPreloader } from "../src/components/scroller/backdropPreloader";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class TestImage {
  static instances: TestImage[] = [];
  static cached = new Set<string>();
  decoding = "";
  fetchPriority = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  get naturalWidth() {
    return TestImage.cached.has(this.src) ? 100 : 0;
  }
  get complete() {
    return TestImage.cached.has(this.src);
  }
  constructor() {
    TestImage.instances.push(this);
  }
}

function gate() {
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return { ready, resolve };
}
const flush = () => vi.advanceTimersByTimeAsync(2);

beforeEach(() => {
  vi.useFakeTimers();
  TestImage.instances = [];
  TestImage.cached.clear();
  vi.stubGlobal("Image", TestImage);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared backdrop preload scheduling", () => {
  it("shares two background slots, with overscan posters ahead of backdrops", async () => {
    const scheduler = createBackdropPreloader();
    const first = gate(),
      second = gate();
    scheduler.protectPosters(["p1", "p2", "p3"], first.ready);
    scheduler.protectPosters(["visible"], second.ready);
    scheduler.warmBackdrops(["b1", "b2"]);
    scheduler.warmPosters(["p1", "p2", "p3"]);
    first.resolve();
    await flush();
    expect(TestImage.instances).toHaveLength(0);
    second.resolve();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["p1", "p2"]);
    TestImage.instances[0].onload?.();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["p1", "p2", "p3"]);
    TestImage.instances[1].onerror?.();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual([
      "p1",
      "p2",
      "p3",
      "b1",
    ]);
    expect(TestImage.instances.every((i) => i.fetchPriority === "low")).toBe(
      true,
    );
  });

  it("promotes queued and active posters without duplicate requests or budget waits", async () => {
    const scheduler = createBackdropPreloader();
    scheduler.warmPosters(["p1", "p2", "p3"]);
    await flush();
    const active = scheduler.requestPosterNow("p1");
    const queued = scheduler.requestPosterNow("p3");
    expect(TestImage.instances.map((i) => i.src)).toEqual(["p1", "p2", "p3"]);
    expect(TestImage.instances[0].fetchPriority).toBe("high");
    expect(TestImage.instances[2].fetchPriority).toBe("high");
    TestImage.instances[0].onload?.();
    TestImage.instances[2].onerror?.();
    await Promise.all([active, queued]);
    await flush();
    expect(TestImage.instances).toHaveLength(3);
    expect(scheduler.requestPosterNow("p3")).toBe(queued);
  });

  it("drops obsolete queued posters without removing another scroller's ownership", async () => {
    const scheduler = createBackdropPreloader();
    const critical = gate();
    scheduler.protectPosters([], critical.ready);
    const cancel = scheduler.warmPosters(["old", "shared"]);
    scheduler.warmPosters(["shared", "new"]);
    cancel();
    critical.resolve();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["shared", "new"]);
  });

  it("lets cached or failed critical posters release optional work", async () => {
    const scheduler = createBackdropPreloader();
    TestImage.cached.add("cached");
    const cached = scheduler.requestPosterNow("cached");
    const failed = scheduler.requestPosterNow("failed");
    scheduler.protectPosters(
      ["cached", "failed"],
      Promise.all([cached, failed]),
    );
    const task = vi.fn();
    scheduler.afterCriticalPosters(task);
    await flush();
    expect(task).not.toHaveBeenCalled();
    TestImage.instances.find((i) => i.src === "failed")!.onerror?.();
    await flush();
    expect(task).toHaveBeenCalledOnce();
  });

  it("cancels optional work and rechecks guards between ready callbacks", async () => {
    const scheduler = createBackdropPreloader();
    const critical = gate();
    const abandoned = vi.fn(),
      next = vi.fn();
    scheduler.afterCriticalPosters(() =>
      scheduler.protectPosters([], critical.ready));
    const cancel = scheduler.afterCriticalPosters(abandoned);
    scheduler.afterCriticalPosters(next);
    cancel();
    await flush();
    expect(abandoned).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    critical.resolve();
    await flush();
    expect(next).toHaveBeenCalledOnce();
  });

  it("exposes stable snapshots and unsubscribes DOM-source listeners", async () => {
    const scheduler = createBackdropPreloader();
    const initial = scheduler.getStartedPosters();
    const listener = vi.fn();
    const unsubscribe = scheduler.subscribe(listener);
    scheduler.requestPosterNow("urgent");
    expect(initial.has("urgent")).toBe(false);
    expect(scheduler.getStartedPosters().has("urgent")).toBe(true);
    const started = scheduler.getStartedPosters();
    scheduler.requestPosterNow("urgent");
    expect(scheduler.getStartedPosters()).toBe(started);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    scheduler.warmPosters(["background"]);
    await flush();
    expect(listener).toHaveBeenCalledOnce();
  });
  it("waits for both scrollers, then limits speculative downloads to two", async () => {
    const scheduler = createBackdropPreloader();
    const first = gate();
    const second = gate();
    scheduler.protectPosters(["p1"], first.ready);
    scheduler.protectPosters(["p2"], second.ready);
    scheduler.warmBackdrops(["b1", "b2", "b3"]);
    first.resolve();
    await flush();
    expect(TestImage.instances).toHaveLength(0);
    second.resolve();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["b1", "b2"]);
    expect(TestImage.instances.every((i) => i.fetchPriority === "low")).toBe(
      true,
    );
    TestImage.instances[0].onload?.();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["b1", "b2", "b3"]);
  });
  it("pauses new background starts when another critical load begins", async () => {
    const scheduler = createBackdropPreloader();
    scheduler.warmBackdrops(["b1", "b2", "b3"]);
    await flush();
    const poster = gate();
    scheduler.protectPosters(["p"], poster.ready);
    TestImage.instances[0].onload?.();
    await flush();
    expect(TestImage.instances).toHaveLength(2);
    poster.resolve();
    await flush();
    expect(TestImage.instances).toHaveLength(3);
  });
  it("deduplicates owners and cancels only obsolete queued work", async () => {
    const scheduler = createBackdropPreloader();
    const poster = gate();
    scheduler.protectPosters(["p"], poster.ready);
    const cancel = scheduler.warmBackdrops(["shared", "obsolete"]);
    scheduler.warmBackdrops(["shared"]);
    cancel();
    poster.resolve();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["shared"]);
    scheduler.warmBackdrops(["shared"]);
    await flush();
    expect(TestImage.instances).toHaveLength(1);
  });
  it("never schedules poster URLs as low-priority backdrops", async () => {
    const scheduler = createBackdropPreloader();
    scheduler.warmBackdrops(["poster"]);
    scheduler.protectPosters(["poster"], Promise.resolve());
    await flush();
    expect(TestImage.instances).toHaveLength(0);
  });
  it("starts the requested detail immediately despite critical loads and a full budget", async () => {
    const scheduler = createBackdropPreloader();
    scheduler.warmBackdrops(["b1", "b2", "selected"]);
    await flush();
    scheduler.protectPosters(["p"], gate().ready);
    scheduler.requestBackdropNow("selected");
    expect(TestImage.instances.map((i) => i.src)).toEqual([
      "b1",
      "b2",
      "selected",
    ]);
    expect(TestImage.instances[2].fetchPriority).toBe("high");
    scheduler.requestBackdropNow("b1");
    expect(TestImage.instances[0].fetchPriority).toBe("high");
    expect(TestImage.instances).toHaveLength(3);
  });
  it("releases the budget on failure and cached completion, and retries failed detail images", async () => {
    const scheduler = createBackdropPreloader();
    TestImage.cached.add("cached");
    scheduler.warmBackdrops(["bad", "cached", "next"]);
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual([
      "bad",
      "cached",
      "next",
    ]);
    TestImage.instances[0].onerror?.();
    await flush();
    scheduler.requestBackdropNow("bad");
    expect(TestImage.instances.at(-1)?.src).toBe("bad");
    expect(TestImage.instances.at(-1)?.fetchPriority).toBe("high");
  });
  it("releases an unmounted poster guard and cancels an unmounted backdrop owner", async () => {
    const scheduler = createBackdropPreloader();
    const release = scheduler.protectPosters(["p"], gate().ready);
    const cancel = scheduler.warmBackdrops(["obsolete"]);
    scheduler.warmBackdrops(["live"]);
    cancel();
    release();
    await flush();
    expect(TestImage.instances.map((i) => i.src)).toEqual(["live"]);
  });
});
