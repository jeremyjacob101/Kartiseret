import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const nodeOnlyTestFiles = [
  "tests/shared/applicationSchemas.test.ts",
  "tests/accounts/authRoutes.test.ts",
  "tests/tooling/check-client-bundle.test.mjs",
  "tests/cinemas/cinemathequeCatalog.test.ts",
  "tests/cinemas/cinemaIdentities.test.ts",
  "tests/cinemas/cinematheques.test.ts",
  "tests/tooling/deploymentConfig.test.ts",
  "tests/shared/externalSchemas.test.ts",
  "tests/movies/movieCatalog.test.ts",
  "tests/movies/movieCatalogLoading.test.ts",
  "tests/preferences/movieDisplayPreferences.test.ts",
  "tests/preferences/preferenceSavePolicy.test.ts",
  "tests/preferences/preferencesSchemas.test.ts",
  "tests/shared/previewData.test.ts",
  "tests/shared/publicationRevision.test.ts",
  "tests/shared/runtimeValidation.test.ts",
  "tests/seo/ogHandler.test.ts",
  "tests/seo/previewHtml.test.ts",
  "tests/seo/seoHandler.test.ts",
  "tests/seo/seoRendering.test.ts",
  "tests/showtimes/showtimeDay.boundaries.test.ts",
  "tests/showtimes/showtimeDay.test.ts",
  "tests/showtimes/showtimeFilters.test.ts",
  "tests/showtimes/showtimeLinkCodec.invariants.test.ts",
  "tests/showtimes/showtimeLinkCodec.test.ts",
  "tests/showtimes/showtimeLinkCodec.validation.test.ts",
  "tests/cinemas/theatersData.test.ts",
  "tests/ticket-alerts/ticketAlertSchemas.test.ts",
];

export default defineConfig({
  plugins: [react()],
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    css: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: nodeOnlyTestFiles,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.{mjs,ts,tsx}"],
          exclude: nodeOnlyTestFiles,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      reportsDirectory: "../coverage/web",
      reporter: ["text", "html"],
    },
  },
});
