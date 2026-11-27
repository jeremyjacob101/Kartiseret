import { expect, test } from "@playwright/test";

const pages = [
  ["Support", "Support"],
  ["Accessibility", "Accessibility"],
  ["Privacy", "Privacy Policy"],
  ["Terms of Use", "Terms of Use"],
  ["Credits", "Credits"],
] as const;

test("direct static-index URLs resolve to the opaque home route", async ({
  page,
}) => {
  await page.goto("/index.html");
  await expect(page).toHaveURL(/\/[a-z0-9]{8}$/);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`Credits logos fit their tiles at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/attribution");
    const logos = page.locator(".site-info-source-logo img");
    await expect(logos).toHaveCount(20);
    for (const logo of await logos.all()) {
      await logo.scrollIntoViewIfNeeded();
      const fits = await logo.evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        const bounds = image.getBoundingClientRect();
        const tile = image.parentElement!.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= tile.left &&
          bounds.top >= tile.top &&
          bounds.right <= tile.right &&
          bounds.bottom <= tile.bottom
        );
      });
      expect(fits, (await logo.getAttribute("src")) ?? undefined).toBe(true);
    }

    for (const name of ["Holon Cinematheque", "Jerusalem Cinematheque"]) {
      await expect(
        page.getByRole("link", { name, exact: true }).locator("img"),
      ).toHaveCSS("filter", "brightness(0)");
    }
    await expect(
      page
        .getByRole("link", { name: "Rotten Tomatoes Audience" })
        .locator("img"),
    ).toHaveCSS("filter", "none");
  });

  test(`site information navigation works at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/support");
    const footer = page.getByRole("navigation", { name: "Footer" });

    for (const [label, title] of pages) {
      await footer.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(/\/[a-z0-9]{8}$/);
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
    const creditsPath = new URL(page.url()).pathname;
    expect(creditsPath).toMatch(/^\/[a-z0-9]{8}$/);
    await expect(page).toHaveURL(`${creditsPath}#licenses-and-rights`);
    await expect(
      page.getByRole("heading", { name: "Licenses & rights" }),
    ).toBeInViewport();

    await footer.getByRole("link", { name: "Terms of Use" }).click();
    await page.getByRole("link", { name: "Report a correction" }).click();
    const supportPath = new URL(page.url()).pathname;
    expect(supportPath).toMatch(/^\/[a-z0-9]{8}$/);
    await expect(page).toHaveURL(`${supportPath}#showtime-corrections`);
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
