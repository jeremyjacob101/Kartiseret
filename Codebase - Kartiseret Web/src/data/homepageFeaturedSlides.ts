import type { HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import type { HomepagePromotion } from "./homepageFeatured";
import type { Movie } from "./movieCatalog";

type FeaturedPayload = HomepageFeaturedResponse["data"];

export type HomepageFeaturedSlide =

    | {
        type: "movie";
        movie: Movie;
        mode: "nowPlaying" | "comingSoon";
        label: string | null;
      }
    | { type: "promotion"; promotion: HomepagePromotion };

const MAX_MOVIE_SLIDES = 5;
const LABELS = { kids: "Kids", "sci-fi": "Sci-Fi", marvel: "Marvel" } as const;

function orderedMovies(
  config: FeaturedPayload,
  nowPlaying: readonly Movie[],
  comingSoon: readonly Movie[],
): HomepageFeaturedSlide[] {
  const available = new Map<
    string,
    { movie: Movie; mode: "nowPlaying" | "comingSoon" }
  >();
  for (const movie of comingSoon)
    available.set(movie.tmdbId, { movie, mode: "comingSoon" });
  for (const movie of nowPlaying)
    available.set(movie.tmdbId, { movie, mode: "nowPlaying" });

  const result: HomepageFeaturedSlide[] = [];
  const selected = new Set<string>();
  const countByMode = { nowPlaying: 0, comingSoon: 0 };
  const add = (tmdbId: string, label: string | null = null) => {
    if (result.length >= MAX_MOVIE_SLIDES || selected.has(tmdbId)) return;
    const entry = available.get(tmdbId);
    if (
      !entry?.movie.movieCode ||
      !(entry.movie.backdropSrc || entry.movie.imageSrc)
    )
      return;
    selected.add(tmdbId);
    countByMode[entry.mode] += 1;
    result.push({ type: "movie", ...entry, label });
  };

  for (const highlight of [...config.highlights].sort(
    (a, b) => b.priority - a.priority,
  )) {
    add(highlight.tmdbId, highlight.label ? LABELS[highlight.label] : null);
  }

  const nowPlayingCandidates = config.lineup?.nowPlayingIds.length
    ? config.lineup.nowPlayingIds
    : nowPlaying.map((movie) => movie.tmdbId);
  const comingSoonCandidates = config.lineup?.comingSoonIds.length
    ? config.lineup.comingSoonIds
    : comingSoon.map((movie) => movie.tmdbId);
  const candidates = {
    nowPlaying: nowPlayingCandidates,
    comingSoon: comingSoonCandidates,
  };

  for (const mode of ["nowPlaying", "comingSoon"] as const) {
    for (const tmdbId of candidates[mode]) {
      if (countByMode[mode] >= 2) break;
      add(tmdbId);
    }
  }

  let candidateIndex = 0;
  while (result.length < MAX_MOVIE_SLIDES && candidateIndex < 80) {
    const mode = candidateIndex % 2 === 0 ? "nowPlaying" : "comingSoon";
    const list = candidates[mode];
    const modeIndex = Math.floor(candidateIndex / 2);
    if (modeIndex < list.length) add(list[modeIndex]);
    candidateIndex += 1;
  }
  return result;
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
