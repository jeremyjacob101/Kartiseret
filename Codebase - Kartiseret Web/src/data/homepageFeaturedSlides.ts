import { homepageFeatureRating, type HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import { getCinemaDayDate } from "@kartiseret/contracts/showtime-day";
import type { HomepagePromotion } from "./homepageFeatured";
import type { Movie } from "./movieCatalog";

type FeaturedPayload = HomepageFeaturedResponse["data"];

type MovieSlide = {
  type: "movie";
  movie: Movie;
  mode: "nowPlaying" | "comingSoon";
  label: string | null;
  ticketsOnSale: boolean;
};

export type HomepageFeaturedSlide =
  MovieSlide | { type: "promotion"; promotion: HomepagePromotion };

const MAX_MOVIE_SLIDES = 6;
const UPCOMING_HORIZON_DAYS = 180;
const MILLISECONDS_PER_DAY = 86_400_000;
const LABELS = { kids: "Kids", "sci-fi": "Sci-Fi", marvel: "Marvel" } as const;

function timingWeight(
  mode: MovieSlide["mode"],
  daysUntilRelease: number | null,
  ticketsOnSale: boolean,
): number {
  if (mode === "nowPlaying") {
    return (
      0.8 + (daysUntilRelease === null ? 0 : 0.2 * 2 ** (daysUntilRelease / 21))
    );
  }
  const proximity =
    daysUntilRelease === null ? 0 : 2 ** (-daysUntilRelease / 30);
  return ticketsOnSale ? 0.52 + 0.38 * proximity : 0.25 + 0.35 * proximity;
}

function orderedMovies(
  config: FeaturedPayload,
  nowPlaying: readonly Movie[],
  comingSoon: readonly Movie[],
): MovieSlide[] {
  const asOf = config.ranking?.asOf ?? getCinemaDayDate();
  const rankingDay = Date.parse(asOf);
  const nowById = new Map(nowPlaying.map((movie) => [movie.tmdbId, movie]));
  const soonById = new Map(comingSoon.map((movie) => [movie.tmdbId, movie]));
  const ticketedIds = new Set(config.ranking?.ticketedUpcomingIds);
  const highlights = new Map(
    config.highlights
      .filter(
        (item) => item.enabled && item.startsOn <= asOf && item.endsOn >= asOf,
      )
      .map((item) => [item.tmdbId, item]),
  );

  const candidates = [];
  for (const tmdbId of new Set([...nowById.keys(), ...soonById.keys()])) {
    const now = nowById.get(tmdbId);
    const soon = soonById.get(tmdbId);
    const releaseDate =
      soon?.releaseDate ??
      config.ranking?.localReleaseDates[tmdbId] ??
      now?.releaseDate;
    const daysUntilRelease = releaseDate
      ? (Date.parse(releaseDate) - rankingDay) / MILLISECONDS_PER_DAY
      : null;
    if (daysUntilRelease !== null && daysUntilRelease > UPCOMING_HORIZON_DAYS)
      continue;
    if (!now && daysUntilRelease !== null && daysUntilRelease < 0) continue;

    const mode =
      now && !(daysUntilRelease !== null && daysUntilRelease > 0)
        ? "nowPlaying"
        : "comingSoon";
    const ordered = mode === "nowPlaying" ? [now, soon] : [soon, now];
    const movie = ordered.find(
      (entry) => entry?.movieCode && (entry.backdropSrc || entry.imageSrc),
    );
    if (!movie) continue;

    const highlight = highlights.get(tmdbId);
    const ticketsOnSale = mode === "nowPlaying" || ticketedIds.has(tmdbId);
    const popularity = Math.max(0, movie.popularity);
    const popularityBonus = 2 * (popularity / (popularity + 30));
    const score =
      (homepageFeatureRating(highlight?.priority) + popularityBonus) *
      timingWeight(mode, daysUntilRelease, ticketsOnSale);
    const slide: MovieSlide = {
      type: "movie",
      movie,
      mode,
      label: highlight?.label ? LABELS[highlight.label] : null,
      ticketsOnSale,
    };
    candidates.push({ slide, score, scheduled: Boolean(highlight) });
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.slide.movie.tmdbId) - Number(b.slide.movie.tmdbId),
  );

  // Reserve membership for scheduled picks, then display everyone by score.
  const chosen = new Set(
    candidates
      .filter((candidate) => candidate.scheduled)
      .slice(0, MAX_MOVIE_SLIDES),
  );
  for (const candidate of candidates) {
    if (chosen.size >= MAX_MOVIE_SLIDES) break;
    chosen.add(candidate);
  }
  return candidates.flatMap((candidate) =>
    chosen.has(candidate) ? [candidate.slide] : []);
}

export function buildHomepageFeaturedSlides(
  config: FeaturedPayload | undefined,
  nowPlaying: readonly Movie[],
  comingSoon: readonly Movie[],
): HomepageFeaturedSlide[] {
  if (!config) return [];
  const movies = orderedMovies(config, nowPlaying, comingSoon);
  const promotion = [...config.promotions].sort(
    (a, b) => b.priority - a.priority,
  )[0];
  if (!promotion) return movies;

  const [lead, ...remaining] = movies;
  const promotionSlide: HomepageFeaturedSlide = {
    type: "promotion",
    promotion,
  };
  return lead ? [lead, promotionSlide, ...remaining] : [promotionSlide];
}
