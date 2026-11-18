function memoizeImport<Value>(
  load: () => Promise<Value>,
): () => Promise<Value> {
  let loaded: Promise<Value> | null = null;
  return () => {
    loaded ??= load();
    return loaded;
  };
}

export const loadCinemaPageModule = memoizeImport(
  () => import("../components/CinemaPage.js"),
);
export const loadUserPreferencesPageModule = memoizeImport(
  () => import("../components/UserPreferencesPage.js"),
);
export const loadPosterGridPageModule = memoizeImport(
  () => import("../components/PosterGridPage.js"),
);
export const loadAllShowtimesPageModule = memoizeImport(
  () => import("../components/AllShowtimesPage.js"),
);
export const loadCinemathequesPageModule = memoizeImport(
  () => import("../components/CinemathequesPage.js"),
);
export const loadMoviePageModule = memoizeImport(
  () => import("../components/MoviePage.js"),
);
