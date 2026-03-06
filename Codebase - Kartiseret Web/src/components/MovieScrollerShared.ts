const TARGET_ITEMS_PER_SIDE = 280;
const MIN_REPEAT_SETS = 5;

export function getRepeatSetCount(
  _itemSpan: number,
  movieCount: number,
): number {
  const safeMovieCount = Math.max(movieCount, 1);
  const setsPerSide = Math.max(
    Math.ceil(TARGET_ITEMS_PER_SIDE / safeMovieCount),
    Math.floor(MIN_REPEAT_SETS / 2),
  );

  return setsPerSide * 2 + 1;
}
