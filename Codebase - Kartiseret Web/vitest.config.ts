import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const nodeOnlyTestFiles = [
  "tests/applicationSchemas.test.ts",
  "tests/authRoutes.test.ts",
  "tests/check-client-bundle.test.mjs",
  "tests/cinemathequeCatalog.test.ts",
  "tests/cinematheques.test.ts",
  "tests/deploymentConfig.test.ts",
  "tests/externalSchemas.test.ts",
  "tests/movieCatalog.test.ts",
  "tests/movieCatalogLoading.test.ts",
  "tests/movieDisplayPreferences.test.ts",
  "tests/preferenceSavePolicy.test.ts",
  "tests/preferencesSchemas.test.ts",
  "tests/previewData.test.ts",
  "tests/publicationRevision.test.ts",
  "tests/runtimeValidation.test.ts",
  "tests/showtimeDay.boundaries.test.ts",
  "tests/showtimeDay.test.ts",
  "tests/showtimeFilters.test.ts",
  "tests/showtimeLinkCodec.invariants.test.ts",
  "tests/showtimeLinkCodec.test.ts",
  "tests/showtimeLinkCodec.validation.test.ts",
  "tests/theatersData.test.ts",
  "tests/ticketAlertSchemas.test.ts",
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
