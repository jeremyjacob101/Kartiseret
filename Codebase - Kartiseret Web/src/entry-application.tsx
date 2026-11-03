import { initializeUserPreferencesStore, preparePublicPagePreferenceState, PublicPreferencesSnapshotProvider } from "./stores/userPreferencesStore";
import { applyBootstrappedDeviceTypeToDocument, initializeDeviceStore } from "./device/useDeviceType";
import { MovieDisplayPreferencesProvider } from "./contexts/MovieDisplayPreferencesProvider";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { StrictMode, useEffect } from "react";
import { BrowserRouter } from "react-router";
import { App } from "./App";

function ClientStartup() {
  useEffect(() => {
    initializeUserPreferencesStore();
    initializeDeviceStore();
    applyBootstrappedDeviceTypeToDocument();
  }, []);

  return null;
}

export function EntryApplication({
  publicPreferenceSnapshot,
}: {
  publicPreferenceSnapshot: ReturnType<
    typeof preparePublicPagePreferenceState
  > | null;
}) {
  const app = (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MovieDisplayPreferencesProvider>
            <App />
            <ClientStartup />
          </MovieDisplayPreferencesProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );

  if (publicPreferenceSnapshot) {
    return (
      <PublicPreferencesSnapshotProvider snapshot={publicPreferenceSnapshot}>
        {app}
      </PublicPreferencesSnapshotProvider>
    );
  }

  return app;
}
