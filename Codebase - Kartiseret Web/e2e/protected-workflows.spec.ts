import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

let testClientIndex = 0;

async function login(page: Page, email = "browser@example.test") {
  await page.goto("/user");
  await expect(page).toHaveURL("/");
  await page
    .getByRole("button", { name: "Sign up or log in", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("local-fixture-only");
  const signedIn = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-in/email"));
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: `Signed in as ${email}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open User Preferences", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "User Preferences", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ page, context }, testInfo) => {
  // Model distinct clients at the trusted local proxy boundary. Production
  // Vercel overwrites this header; keep the real database limiter enabled.
  await context.setExtraHTTPHeaders({
    "X-Forwarded-For": `198.18.${testInfo.workerIndex}.${++testClientIndex}`,
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
    });
  });
});
test("account settings, failed save rollback, alerts, refresh and logout use protected APIs", async ({
  page,
}) => {
  const tableRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/rest/v1/"))
      tableRequests.push(request.url());
  });
  await login(page);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith("/api/v1/preferences"),
  );
  await page.getByRole("button", { name: "Use Blue site color" }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Use Blue site color" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.route("**/api/v1/preferences", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          error: {
            code: "fixture_save_failure",
            message: "Fixture save unavailable",
          },
        }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Use Green site color" }).click();
  await expect(page.getByText("Fixture save unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use Blue site color" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.unroute("**/api/v1/preferences");
  await page.goto("/D11");
  await page
    .getByRole("button", {
      name: "Notify me when tickets for Dev Coming Soon go on sale",
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Cancel ticket alert for Dev Coming Soon",
    }),
  ).toBeVisible();
  await page.goto("/user");
  await page
    .getByRole("button", { name: "Cancel ticket alert for Dev Coming Soon" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Cancel ticket alert for Dev Coming Soon",
    }),
  ).toHaveCount(0);
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Signed in as browser@example.test" })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign up or log in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "User Preferences", exact: true }),
  ).toHaveCount(0);
  expect(tableRequests).toEqual([]);
});
test("admin correction uses the authenticated transaction while non-admins are denied", async ({
  page,
}) => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      'DELETE FROM public."finalMovies" WHERE tmdb_id IN (9300001,9300002)',
    );
    await db.query(
      "INSERT INTO public.\"finalMovies\" (tmdb_id,english_title) VALUES (9300001,'Admin Browser Fixture')",
    );
    await login(page, "admin@example.test");
    await page.goto("/movies");
    await page
      .getByRole("button", { name: "Edit mapping for Admin Browser Fixture" })
      .click();
    await page.getByLabel("Manual TMDB ID").fill("9300002");
    const corrected = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/admin/movie-corrections"));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await corrected).status()).toBe(200);
    expect(
      (
        await db.query(
          'SELECT tmdb_id,solo_update FROM public."finalMovies" WHERE tmdb_id=9300002',
        )
      ).rows,
    ).toEqual([{ tmdb_id: 9300002, solo_update: true }]);
    await page.request.post("/api/auth/sign-out", {
      headers: { Origin: new URL(page.url()).origin },
    });
    await page.request.post("/api/auth/sign-in/email", {
      headers: { Origin: new URL(page.url()).origin },
      data: { email: "browser@example.test", password: "local-fixture-only" },
    });
    const denied = await page.request.post("/api/v1/admin/movie-corrections", {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        mode: "nowPlaying",
        currentTmdbId: "9300002",
        selectedTmdbId: "9300003",
        isManualEntry: true,
      },
    });
    expect(denied.status()).toBe(403);
    await page.request.post("/api/auth/sign-out", {
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(
      (
        await page.request.get("/api/v1/account", {
          headers: { Authorization: "Bearer fabricated" },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await db.query(
      'DELETE FROM public."finalMovies" WHERE tmdb_id IN (9300001,9300002)',
    );
    await db.query(
      "DELETE FROM public.\"tableFixes\" WHERE title_fix='9300001'",
    );
    await db.end();
  }
});

test("real signup verification, current-password change and signed-out one-time recovery", async ({
  page,
  request,
}) => {
  const email = `pr5-browser-${Date.now()}@example.test`;
  const origin = "http://127.0.0.1:" + (process.env.PR3_E2E_WEB_PORT ?? 4173);
  const api = "http://127.0.0.1:" + (process.env.PR3_E2E_API_PORT ?? 3210);
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function captured(kind: string) {
    const response = await request.get(
      `${api}/__test/mail?email=${encodeURIComponent(email)}`,
    );
    const rows = (await response.json()) as { kind: string; url: string }[];
    const item = rows.findLast((row) => row.kind === kind);
    expect(item).toBeDefined();
    return item!.url;
  }
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Sign up or log in", exact: true })
      .click();
    await page.getByRole("tab", { name: "Sign up", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-password-123");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByText("Check your email to confirm your account, then log in."),
    ).toBeVisible();
    await page.goto(await captured("verification"));
    await expect(
      page.getByText("Email confirmed. You can now log in."),
    ).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-password-123");
    const signedIn = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    expect((await signedIn).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: `Signed in as ${email}` }),
    ).toBeVisible();
    await page.goto("/user");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "User Preferences", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Current password", { exact: true })
      .fill("browser-password-123");
    await page
      .getByLabel("New password", { exact: true })
      .fill("changed-browser-123");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("changed-browser-123");
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      page.getByText("Password updated.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("banner")
      .getByRole("button", { name: `Signed in as ${email}` })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign up or log in", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Forgot password?", exact: true })
      .click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();
    await expect(
      page.getByText(
        "If an account exists for that email, you’ll receive a reset link.",
      ),
    ).toBeVisible();
    await page.goto(await captured("reset"));
    const resetPath = page.url();
    await page
      .getByLabel("New password", { exact: true })
      .fill("reset-browser-123");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("reset-browser-123");
    await page
      .getByRole("button", { name: "Update password", exact: true })
      .click();
    await expect(
      page.getByText("Password updated. You can now return to Kartiseret."),
    ).toBeVisible();
    await page.goto(resetPath);
    await page
      .getByLabel("New password", { exact: true })
      .fill("another-browser-123");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("another-browser-123");
    await page
      .getByRole("button", { name: "Update password", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto(`${origin}/reset-password?error=INVALID_TOKEN`);
    await expect(
      page.getByRole("heading", {
        name: "This reset link is invalid or expired",
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await db.query("DELETE FROM app_auth.users WHERE email=$1", [email]);
    await db.end();
  }
});
