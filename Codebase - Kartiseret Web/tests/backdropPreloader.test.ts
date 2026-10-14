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
