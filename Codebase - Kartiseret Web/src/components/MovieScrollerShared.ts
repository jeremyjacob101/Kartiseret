const MAX_TRACK_PX = 12_000_000;

export function getRepeatSetCount(
  itemSpan: number,
  movieCount: number,
): number {
  const setsByWidth = Math.floor(
    MAX_TRACK_PX / Math.max(itemSpan * movieCount, 1),
  );
  const bounded = Math.max(101, setsByWidth);
  return bounded % 2 === 0 ? bounded + 1 : bounded;
}
