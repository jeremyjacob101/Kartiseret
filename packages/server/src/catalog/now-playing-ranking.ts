import { tmdbIdSchema } from "@kartiseret/contracts/runtime";
import {
  getZonedDateTimeParts,
  SHOWTIME_TIME_ZONE,
} from "@kartiseret/contracts/showtime-day";

const MILLISECONDS_PER_DAY = 86_400_000;
const RELEASE_RECENCY_MIDPOINT_DAYS = 17;
const RELEASE_RECENCY_SLOPE_DAYS = 5;
const RECENCY_SCORE_PRECISION = 1_000_000;

type RankValue = number | null;

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
  return left - right;
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
 * equally. The first two signals use catalog percentiles; release proximity is
 * a smooth 0–1 curve that peaks on the release date and decays symmetrically
 * before and after it. Integer-scaled signals preserve exact final ties.
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
  const releaseProximityScores = rows.map((row) => {
    const releaseDate = calendarDate(readField(row, "localReleaseDate"));
    // Database rows carry the statement's Israel calendar date, keeping this
    // check aligned with showtime counts even across local midnight.
    const rankingDate =
      calendarDate(readField(row, "rankingDate")) ?? fallbackRankingDate;
    if (releaseDate === null) return 0;
    const releaseDay = Date.parse(`${releaseDate}T00:00:00.000Z`);
    const rankingDay = Date.parse(`${rankingDate}T00:00:00.000Z`);
    const distanceInDays =
      Math.abs(releaseDay - rankingDay) / MILLISECONDS_PER_DAY;
    return Math.round(
      RECENCY_SCORE_PRECISION /
        (1 +
          Math.exp(
            (distanceInDays - RELEASE_RECENCY_MIDPOINT_DAYS) /
              RELEASE_RECENCY_SLOPE_DAYS,
          )),
    );
  });
  const percentileDenominator = Math.max(1, 2 * (rows.length - 1));

  return rows
    .map((row, index) => ({
      row,
      tmdbId: BigInt(tmdbIdSchema.parse(readField(row, "tmdbId"))),
      score:
        (popularityRanks[index] ?? 0) * RECENCY_SCORE_PRECISION +
        (showtimeRanks[index] ?? 0) * RECENCY_SCORE_PRECISION +
        (releaseProximityScores[index] ?? 0) * percentileDenominator,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.tmdbId < right.tmdbId ? -1 : left.tmdbId > right.tmdbId ? 1 : 0),
    )
    .map(({ row }) => row);
}
