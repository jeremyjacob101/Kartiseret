import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Suites share one disposable database and exercise real schema changes.
    // Their fixture writes/renames must not overlap across test files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
    restoreMocks: true,
  },
});
