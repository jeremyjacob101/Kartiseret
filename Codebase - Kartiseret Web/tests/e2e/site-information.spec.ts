import { expect, test } from "@playwright/test";

const pages = [
  ["Support", "Support", "/support"],
  ["Accessibility", "Accessibility", "/accessibility"],
  ["Privacy", "Privacy Policy", "/privacy"],
  ["Terms of Use", "Terms of Use", "/terms"],
  ["Credits", "Credits", "/attribution"],
] as const;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`site information navigation works at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/support");
    const footer = page.getByRole("navigation", { name: "Footer" });

    for (const [label, title, path] of pages) {
      await footer.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(path);
      await expect(page).toHaveTitle(`${title} | Kartiseret`);
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeInViewport();
      await expect(
        footer.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Credits" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "On this page" })
      .getByRole("link", { name: "Licenses & rights" })
      .click();
    await expect(page).toHaveURL("/attribution#licenses-and-rights");
    await expect(
      page.getByRole("heading", { name: "Licenses & rights" }),
    ).toBeInViewport();

    await footer.getByRole("link", { name: "Terms of Use" }).click();
    await page.getByRole("link", { name: "Report a correction" }).click();
    await expect(page).toHaveURL("/support#showtime-corrections");
    await expect(
      page.getByRole("heading", { name: "Showtimes and corrections" }),
    ).toBeInViewport();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Showtimes and corrections" }),
    ).toBeInViewport();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(
      page.getByRole("button", { name: "Go to homepage", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Go to top of home page" }),
    ).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      1,
    );
  });
}
