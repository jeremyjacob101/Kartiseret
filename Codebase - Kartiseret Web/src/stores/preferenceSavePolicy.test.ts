import { describe, expect, it } from "vitest";
import { shouldRollbackOptimisticSave } from "./preferenceSavePolicy";

describe("optimistic preference rollback", () => {
  const valuesEqual = (left: string, right: string) => left === right;

  it("rolls back when the failed value is still the latest intent", () => {
    expect(
      shouldRollbackOptimisticSave({
        currentValue: "Haifa",
        failedValue: "Haifa",
        hasQueuedSave: false,
        valuesEqual,
      }),
    ).toBe(true);
  });

  it("preserves a newer optimistic value and a coalesced queued save", () => {
    expect(
      shouldRollbackOptimisticSave({
        currentValue: "Tel Aviv",
        failedValue: "Haifa",
        hasQueuedSave: false,
        valuesEqual,
      }),
    ).toBe(false);
    expect(
      shouldRollbackOptimisticSave({
        currentValue: "Haifa",
        failedValue: "Haifa",
        hasQueuedSave: true,
        valuesEqual,
      }),
    ).toBe(false);
  });
});
