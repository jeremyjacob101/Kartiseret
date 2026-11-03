import { expect, test } from "@playwright/test";

test("does not expose the SEO fallback in a JavaScript browser while the app bundle is delayed", async ({
  page,
}) => {
  await page.route("**/src/App.tsx**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator("#seo-content")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Now Playing" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("#seo-content")).toHaveCount(0);
});
