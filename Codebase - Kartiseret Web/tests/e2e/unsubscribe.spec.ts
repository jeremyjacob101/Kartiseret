import { expect, test } from "@playwright/test";

const token = "A".repeat(43);
const watchlist = {
  id: "00000000-0000-4000-8000-000000000101",
  sourceUrl: "https://letterboxd.com/fixture/watchlist/",
  sourceType: "watchlist",
};
const list = {
  id: "00000000-0000-4000-8000-000000000102",
  sourceUrl: "https://letterboxd.com/fixture/list/favorites/",
  sourceType: "list",
};

test("the public Letterboxd page can remove one list while signed out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let sources = [watchlist, list];
  const submittedBodies: unknown[] = [];
  const apiRequestUrls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/unsubscribe/")) {
      apiRequestUrls.push(url.pathname + url.search);
      expect(url.href).not.toContain(token);
      expect(request.headers().referer).toBeUndefined();
    }
  });
  await page.route("**/api/v1/unsubscribe/letterboxd", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { sources }, error: null }),
      });
      return;
    }
    const body = request.postDataJSON() as { sourceIds: string[] };
    submittedBodies.push(body);
    const removed = sources.filter((source) =>
      body.sourceIds.includes(source.id));
    sources = sources.filter((source) => !body.sourceIds.includes(source.id));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { removed }, error: null }),
    });
  });

  await page.goto(`/unsubscribe/letterboxd#token=${token}`);
  await expect(
    page.getByRole("heading", { name: "Manage Letterboxd list alerts" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Individual movie watches and your other connected lists stay active/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign up or log in" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /fixture\/watchlist/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /fixture\/list\/favorites/ }),
  ).toBeVisible();
  await expect(page).toHaveURL("/unsubscribe/letterboxd");

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: /fixture\/watchlist/ }),
  ).toBeFocused();
  await page.getByRole("checkbox", { name: /fixture\/watchlist/ }).check();
  await page.getByRole("button", { name: "Remove selected lists" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove these lists?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm removal" }).click();

  await expect(page.getByText(/Removed: fixture\/watchlist/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /fixture\/list\/favorites/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /fixture\/watchlist/ }),
  ).toHaveCount(0);
  expect(submittedBodies).toEqual([{ sourceIds: [watchlist.id] }]);
  expect(apiRequestUrls.length).toBeGreaterThanOrEqual(3);
});
