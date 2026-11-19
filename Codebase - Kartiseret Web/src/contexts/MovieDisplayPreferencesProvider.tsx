import { indexMovieDisplayPreferences, movieDisplayPreferencesQueryOptions } from "../data/movieDisplayPreferences";
import { MovieDisplayPreferencesContext } from "./MovieDisplayPreferencesContext";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";

export function MovieDisplayPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading, documentDisplay } = useUserPreferencesStore(
    useShallow((state) => ({
      user: state.user,
      loading: state.loading,
      documentDisplay: state.documentDisplay,
    })),
  );
  const preferencesQuery = useQuery(
    movieDisplayPreferencesQueryOptions(user?.id ?? null),
  );
  const preferencesById = useMemo(
    () =>
      indexMovieDisplayPreferences(
        preferencesQuery.data ?? documentDisplay?.movieTreatments ?? [],
      ),
    [preferencesQuery.data, documentDisplay],
  );
  const ready =
    documentDisplay?.movieTreatments != null ||
    (!loading && (!user || preferencesQuery.isSuccess));
  const error =
    preferencesQuery.error instanceof Error ? preferencesQuery.error : null;

  const value = useMemo(
    () => ({ preferencesById, ready, error }),
    [preferencesById, ready, error],
  );

  return (
    <MovieDisplayPreferencesContext.Provider value={value}>
      {children}
    </MovieDisplayPreferencesContext.Provider>
  );
}
