import { type PropsWithChildren } from "react";
import { UserPreferencesContext, useUserPreferences } from "./useUserPreferences";

export function UserPreferencesProvider({ children }: PropsWithChildren) {
  const state = useUserPreferences();

  return (
    <UserPreferencesContext.Provider
      value={state}
    >
      {children}
    </UserPreferencesContext.Provider>
  );
}
