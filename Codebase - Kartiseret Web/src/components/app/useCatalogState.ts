import { useCallback, useEffect, useState } from "react";
import {
  comingSoonMovies,
  loadMovieCatalog,
  movies,
} from "../../data/movieCatalog";
import { preloadTheaters } from "../../data/theaters";
import { type MovieSearchCollection } from "../topbar/search/MovieSearchMenu";
import { type AppPathname } from "./appRouting";

const SEARCH_COLLECTIONS = [
  {
    mode: "nowPlaying",
    label: "Now Playing",
    movies,
  },
  {
    mode: "comingSoon",
    label: "Coming Soon",
    movies: comingSoonMovies,
  },
] satisfies readonly MovieSearchCollection[];

type CatalogState = {
  catalogError: string | null;
  catalogReady: boolean;
  requestCatalogLoad: () => void;
  searchCollections: readonly MovieSearchCollection[];
};

function getCatalogErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Failed to load movie data from Supabase.";
}

export function useCatalogState(pathname: AppPathname): CatalogState {
  const [catalogReady, setCatalogReady] = useState(() => movies.length > 0);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    if (catalogReady || pathname === "/user") {
      return;
    }

    loadMovieCatalog()
      .then(() => {
        if (isActive) {
          setCatalogReady(true);
          setCatalogError(null);
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        console.error("Failed to load movie catalog from Supabase.", error);
        setCatalogError(getCatalogErrorMessage(error));
      });

    return () => {
      isActive = false;
    };
  }, [catalogReady, pathname]);

  useEffect(() => {
    if (!catalogReady || pathname !== "/") {
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const runPreload = () => {
      preloadTheaters();
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          runPreload();
        },
        { timeout: 1200 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        runPreload();
      }, 300);
    }

    return () => {
      if (
        idleId !== null &&
        typeof windowWithIdleCallbacks.cancelIdleCallback === "function"
      ) {
        windowWithIdleCallbacks.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [catalogReady, pathname]);

  const requestCatalogLoad = useCallback(() => {
    if (catalogReady) {
      return;
    }

    void loadMovieCatalog()
      .then(() => {
        setCatalogReady(true);
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        console.error("Failed to load movie catalog from Supabase.", error);
        setCatalogError(getCatalogErrorMessage(error));
      });
  }, [catalogReady]);

  return {
    catalogError,
    catalogReady,
    requestCatalogLoad,
    searchCollections: SEARCH_COLLECTIONS,
  };
}
