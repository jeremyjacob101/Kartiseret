import { expect, test } from "@playwright/test";

test("city showtimes routes are shareable and work with browser history", async ({
  page,
}) => {
  await page.goto("/showtimes/tel-aviv");

  await expect(
    page.getByRole("heading", { name: "New Releases in Tel Aviv" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Movie showtimes in Tel Aviv — Now Playing | Kartiseret",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://seret.site/showtimes/tel-aviv",
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "New Releases in Tel Aviv" }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Movie showtimes in Tel Aviv — Now Playing | Kartiseret",
  );

  await page.getByText("Browse showtimes by city in Israel").click();
  await page
    .getByRole("link", { name: "Movie showtimes in Jerusalem" })
    .click();
  await expect(page).toHaveURL(/\/showtimes\/jerusalem$/);
  await expect(
    page.getByRole("heading", { name: "New Releases in Jerusalem" }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/showtimes\/tel-aviv$/);
  await expect(page).toHaveTitle(
    "Movie showtimes in Tel Aviv — Now Playing | Kartiseret",
  );
});
