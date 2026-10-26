import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import {
  getZonedDateTimeParts,
  SHOWTIME_TIME_ZONE,
} from "@kartiseret/contracts/showtime-day";

const MILLISECONDS_PER_DAY = 86_400_000;
const RELEASE_RECENCY_WINDOW_DAYS = 14;

type RankValue = number | string | null;

function readField(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function compareRankValues(left: RankValue, right: RankValue): number {
  if (left === null || right === null) {
    if (left !== right) return left === null ? -1 : 1;
    return 0;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function percentileRankNumerators(values: readonly RankValue[]): number[] {
  const ranked = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => compareRankValues(left.value, right.value));
  const rankNumerators = Array.from({ length: values.length }, () => 1);
  if (ranked.length <= 1) return rankNumerators;

  let start = 0;
  while (start < ranked.length) {
    let end = start + 1;
    while (
      end < ranked.length &&
      compareRankValues(ranked[start]!.value, ranked[end]!.value) === 0
    ) {
      end += 1;
    }

    const rankNumerator = start + end - 1;
    for (let index = start; index < end; index += 1) {
      rankNumerators[ranked[index]!.index] = rankNumerator;
    }
    start = end;
  }

  return rankNumerators;
}

/**
 * Average popularity, upcoming showtime count, and release-date proximity
 * percentiles equally. Dates within 14 days of today rank highest on either
 * side of the local release date; further-future dates receive no recency
 * credit, and older released dates rank newest first. All percentiles share a
 * denominator, so integer midrank numerators preserve exact final ties.
 */
export function orderNowPlayingRows<T>(
  rows: readonly T[],
  instant: Date = new Date(),
): T[] {
  const fallbackRankingDate = getZonedDateTimeParts(
    SHOWTIME_TIME_ZONE,
    instant,
  ).date;
  const popularityRanks = percentileRankNumerators(
    rows.map((row) => numericValue(readField(row, "popularity"))),
  );
  const showtimeRanks = percentileRankNumerators(
    rows.map((row) =>
      Math.max(0, numericValue(readField(row, "upcomingShowtimeCount")) ?? 0),
    ),
  );
  const releaseDateRanks = percentileRankNumerators(
    rows.map((row) => {
      const releaseDate = calendarDate(readField(row, "localReleaseDate"));
      // Database rows carry the statement's Israel calendar date, keeping this
      // check aligned with showtime counts even across local midnight.
      const rankingDate =
        calendarDate(readField(row, "rankingDate")) ?? fallbackRankingDate;
      if (releaseDate === null) return null;
      const releaseDay = Date.parse(`${releaseDate}T00:00:00.000Z`);
      const rankingDay = Date.parse(`${rankingDate}T00:00:00.000Z`);
      const dayOffset = Math.round(
        (releaseDay - rankingDay) / MILLISECONDS_PER_DAY,
      );
      const distanceFromRelease = Math.abs(dayOffset);
      if (distanceFromRelease <= RELEASE_RECENCY_WINDOW_DAYS) {
        const proximityRank = String(
          RELEASE_RECENCY_WINDOW_DAYS - distanceFromRelease,
        ).padStart(2, "0");
        return `1:${proximityRank}`;
      }
      return dayOffset < 0 ? `0:${releaseDate}` : null;
    }),
  );

  return rows
    .map((row, index) => ({
      row,
      tmdbId: BigInt(tmdbIdSchema.parse(readField(row, "tmdbId"))),
      score:
        10 * (popularityRanks[index] ?? 0) +
        10 * (showtimeRanks[index] ?? 0) +
        10 * (releaseDateRanks[index] ?? 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.tmdbId < right.tmdbId ? -1 : left.tmdbId > right.tmdbId ? 1 : 0),
    )
    .map(({ row }) => row);
}
