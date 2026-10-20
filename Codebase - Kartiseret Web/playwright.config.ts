import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.PR3_E2E_API_PORT ?? 3_210);
const webPort = Number(process.env.PR3_E2E_WEB_PORT ?? 4_173);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

function assertDisposableDatabase(): void {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "PR 3 browser tests require DATABASE_URL to target local kartiseret_test PostgreSQL.",
    );
  }

  const database = new URL(value);
  const databaseName = decodeURIComponent(
    database.pathname.replace(/^\/+/, ""),
  );
  if (
    !["localhost", "127.0.0.1", "::1"].includes(database.hostname) ||
    databaseName !== "kartiseret_test"
  ) {
    throw new Error(
      "PR 3 browser tests refuse non-local databases; use the disposable kartiseret_test database.",
    );
  }
}

assertDisposableDatabase();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webUrl,
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "npm --prefix .. run server:build && node ../packages/server/scripts/e2e-server.mjs",
      url: `${apiUrl}/api/v1/health`,
      env: {
        NODE_ENV: "test",
        PORT: String(apiPort),
        BETTER_AUTH_URL: webUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webUrl,
      env: {
        VITE_API_PROXY_TARGET: apiUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
