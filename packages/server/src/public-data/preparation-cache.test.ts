import { describe, expect, it, vi } from "vitest";
import {
  createPublicDataPreparationSnapshot,
  getPreparedPublicData,
} from "./preparation-cache.js";

function snapshot(repository: object) {
  return createPublicDataPreparationSnapshot(repository, "1", {
    rankingDate: "2026-11-17",
  });
}

describe("preparation cache failure and concurrency edges", () => {
  it("releases waiters on rollback even when preparation has not finished", async () => {
    const repository = {};
    const owner = snapshot(repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = owner.run(() =>
      getPreparedPublicData(repository, "catalog", [], async () => {
        await gate;
        return { title: "rolled back" };
      }),
    );
    const waiter = snapshot(repository);
    const rebuild = vi.fn(async () => ({ title: "fresh" }));
    const waiting = waiter.run(() =>
      getPreparedPublicData(repository, "catalog", [], rebuild),
    );
    owner.discard();
    expect(await waiting).toEqual({ title: "fresh" });
    waiter.commit();
    release();
    await slow;
    const reader = snapshot(repository);
    expect(
      await reader.run(() =>
        getPreparedPublicData(repository, "catalog", [], rebuild),
      ),
    ).toEqual({ title: "fresh" });
    reader.commit();
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it("avoids circular waits when snapshots acquire preparations in opposite orders", async () => {
    const repository = {};
    const one = snapshot(repository);
    const two = snapshot(repository);
    await one.run(() =>
      getPreparedPublicData(repository, "a", [], async () => ({ value: "a" })),
    );
    await two.run(() =>
      getPreparedPublicData(repository, "b", [], async () => ({ value: "b" })),
    );
    const result = await Promise.all([
      one.run(() =>
        getPreparedPublicData(repository, "b", [], async () => ({
          value: "b",
        })),
      ),
      two.run(() =>
        getPreparedPublicData(repository, "a", [], async () => ({
          value: "a",
        })),
      ),
    ]);
    expect(result).toEqual([{ value: "b" }, { value: "a" }]);
    one.commit();
    two.commit();
  });
});
