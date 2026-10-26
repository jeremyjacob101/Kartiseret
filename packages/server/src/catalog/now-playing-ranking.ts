import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import {
  getZonedDateTimeParts,
  SHOWTIME_TIME_ZONE,
} from "@kartiseret/contracts/showtime-day";

export const NEAR_TERM_SHOWTIME_DAYS = 14;

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
 * Average popularity, showtimes, and released-date recency percentiles equally.
 * The showtime signal is 80% near-term and 20% distant; its distant contribution
 * is therefore capped independently of the number of advance screenings.
 * All percentiles share a denominator, so integer midrank numerators and integer
 * weights preserve exact final ties. Future dates share the missing-date rank.
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
  const nearShowtimeRanks = percentileRankNumerators(
    rows.map((row) =>
      Math.max(0, numericValue(readField(row, "nearShowtimeCount")) ?? 0),
    ),
  );
  const distantShowtimeRanks = percentileRankNumerators(
    rows.map((row) =>
      Math.max(0, numericValue(readField(row, "distantShowtimeCount")) ?? 0),
    ),
  );
  const releaseDateRanks = percentileRankNumerators(
    rows.map((row) => {
      const releaseDate = calendarDate(readField(row, "localReleaseDate"));
      // Database rows carry the statement's Israel calendar date, keeping this
      // check aligned with the screening windows even across local midnight.
      const rankingDate =
        calendarDate(readField(row, "rankingDate")) ?? fallbackRankingDate;
      return releaseDate !== null && releaseDate <= rankingDate
        ? releaseDate
        : null;
    }),
  );

  return rows
    .map((row, index) => ({
      row,
      tmdbId: BigInt(tmdbIdSchema.parse(readField(row, "tmdbId"))),
      score:
        10 * (popularityRanks[index] ?? 0) +
        8 * (nearShowtimeRanks[index] ?? 0) +
        2 * (distantShowtimeRanks[index] ?? 0) +
        10 * (releaseDateRanks[index] ?? 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.tmdbId < right.tmdbId ? -1 : left.tmdbId > right.tmdbId ? 1 : 0),
    )
    .map(({ row }) => row);
}
