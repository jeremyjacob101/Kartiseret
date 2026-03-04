const MAX_TRACK5_PX = 12_000_000;

export function getRepeatSetCount5(
  itemSpan: number,
  movieCount: number,
): number {
  const setsByWidth = Math.floor(
    MAX_TRACK5_PX / Math.max(itemSpan * movieCount, 1),
  );
  const bounded = Math.max(101, setsByWidth);
  return bounded % 2 === 0 ? bounded + 1 : bounded;
}
