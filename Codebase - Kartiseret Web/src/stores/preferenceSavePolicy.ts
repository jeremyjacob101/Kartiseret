export type OptimisticRollbackDecision<Value> = {
  currentValue: Value;
  failedValue: Value;
  hasQueuedSave: boolean;
  valuesEqual: (left: Value, right: Value) => boolean;
};

/**
 * A failed write may roll back only when it is still the newest user intent.
 * A queued save or a newer optimistic value always wins.
 */
export function shouldRollbackOptimisticSave<Value>({
  currentValue,
  failedValue,
  hasQueuedSave,
  valuesEqual,
}: OptimisticRollbackDecision<Value>): boolean {
  return !hasQueuedSave && valuesEqual(currentValue, failedValue);
}
