import { initializeUserPreferencesStore, preparePublicPagePreferenceState, PublicPreferencesSnapshotProvider } from "./stores/userPreferencesStore";
import { applyBootstrappedDeviceTypeToDocument, initializeDeviceStore } from "./device/useDeviceType";
import { MovieDisplayPreferencesProvider } from "./contexts/MovieDisplayPreferencesProvider";
import { PublicRenderClockProvider } from "./contexts/PublicRenderClock";
import { StrictMode, useEffect, useLayoutEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router";
import { queryClient } from "./lib/queryClient";
import { App } from "./App";

function ApplicationRoutes() {
  const location = useLocation();
  if (location.pathname === "/unsubscribe/letterboxd") return <App />;
  return (
    <MovieDisplayPreferencesProvider>
      <App />
      <ClientStartup />
    </MovieDisplayPreferencesProvider>
  );
}

function ClientStartup() {
  useLayoutEffect(() => {
    const root = document.getElementById("root");
    const hasIntroCards = root?.querySelector(
      '.movie-scroller-card[data-movie-scroller-intro-card="true"]',
    );
    if (!hasIntroCards) {
      document.documentElement.classList.remove("no-js");
      document.documentElement.classList.add("js");
    }
  }, []);

  useEffect(() => {
    initializeUserPreferencesStore();
    initializeDeviceStore();
    applyBootstrappedDeviceTypeToDocument();
  }, []);

  return null;
}

export function EntryApplication({
  publicPreferenceSnapshot,
  renderedAt,
}: {
  publicPreferenceSnapshot: ReturnType<
    typeof preparePublicPagePreferenceState
  > | null;
  renderedAt?: string;
}) {
  const app = (
    <PublicRenderClockProvider initialInstant={renderedAt}>
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ApplicationRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>
    </PublicRenderClockProvider>
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
