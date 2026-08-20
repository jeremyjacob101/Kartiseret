import { create } from "zustand";
import type { CatalogMode } from "../data/movieCatalog";

export type CatalogPageView = "grid" | "scroller";

export type CatalogMovieJumpRequest = {
  tmdbId: string;
  mode: CatalogMode;
  nonce: number;
  behavior: ScrollBehavior;
};

type CatalogUiStoreState = {
  movieJumpRequest: CatalogMovieJumpRequest | null;
  moviesPageView: CatalogPageView;
  soonsPageView: CatalogPageView;
  openCatalogMovie: (mode: CatalogMode, tmdbId: string) => void;
  resetCatalogPage: (mode: CatalogMode) => void;
};

export const useCatalogUiStore = create<CatalogUiStoreState>()((set) => ({
  movieJumpRequest: null,
  moviesPageView: "grid",
  soonsPageView: "grid",
  openCatalogMovie: (mode, tmdbId) => {
    set({
      movieJumpRequest: {
        tmdbId,
        mode,
        nonce: Date.now(),
        behavior: "smooth",
      },
      ...(mode === "nowPlaying"
        ? { moviesPageView: "scroller" as const }
        : { soonsPageView: "scroller" as const }),
    });
  },
  resetCatalogPage: (mode) => {
    set({
      movieJumpRequest: null,
      ...(mode === "nowPlaying"
        ? { moviesPageView: "grid" as const }
        : { soonsPageView: "grid" as const }),
    });
  },
}));
