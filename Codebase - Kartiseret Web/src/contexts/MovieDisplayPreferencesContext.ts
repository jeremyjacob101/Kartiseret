import type { MovieDisplayPreferencesById } from "../data/movieDisplayPreferences";
import { createContext, useContext } from "react";

export type MovieDisplayPreferencesContextValue = {
  preferencesById: MovieDisplayPreferencesById;
  ready: boolean;
  error: Error | null;
};

const EMPTY_PREFERENCES: MovieDisplayPreferencesById = new Map();

export const MovieDisplayPreferencesContext =
  createContext<MovieDisplayPreferencesContextValue>({
    preferencesById: EMPTY_PREFERENCES,
    ready: true,
    error: null,
  });

export function useMovieDisplayPreferences() {
  return useContext(MovieDisplayPreferencesContext);
}
