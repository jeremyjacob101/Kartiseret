import { expect, test } from "@playwright/test";

const dayPickerWidths = [
  320, 390, 600, 699, 700, 701, 760, 900, 1_024, 1_055, 1_056, 1_095, 1_096,
  1_280, 1_920, 2_560,
];

async function expectVisibleDayCentersReachable(
  page: import("@playwright/test").Page,
  rootSelector: string,
): Promise<void> {
  const report = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const scroll = root?.querySelector(".showtime-day-picker-scroll");

    if (!root || !scroll) {
      return { missing: true, unreachable: [] };
    }

    const scrollRect = scroll.getBoundingClientRect();
    const unreachable = Array.from(
      scroll.querySelectorAll<HTMLButtonElement>(
        '.showtime-day-button[role="radio"]',
      ),
    )
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const centerX = (rect.left + rect.right) / 2;
        const centerY = (rect.top + rect.bottom) / 2;

        if (
          centerX <= scrollRect.left ||
          centerX >= scrollRect.right ||
          centerY <= scrollRect.top ||
          centerY >= scrollRect.bottom
        ) {
          return null;
        }

        const hit = document.elementFromPoint(centerX, centerY);

        return hit?.closest('.showtime-day-button[role="radio"]') === button
          ? null
          : button.getAttribute("aria-label");
      })
      .filter((label): label is string => label !== null);

    return { missing: false, unreachable };
  }, rootSelector);

  expect(report.missing, `Missing picker ${rootSelector}`).toBe(false);
  expect(
    report.unreachable,
    `Date centers covered at ${await page.title()}`,
  ).toEqual([]);
}

async function expectControlsClearOfArrows(
  page: import("@playwright/test").Page,
  rootSelector: string,
  citySelector: string,
  actionsSelector: string,
): Promise<void> {
  const overlaps = await page.evaluate(
    ({ rootSelector, citySelector, actionsSelector }) => {
      const root = document.querySelector(rootSelector);
      const picker = root?.querySelector(
        rootSelector === ".all-showtimes-day-picker-shell"
          ? ".all-showtimes-day-picker-scroll"
          : ".showtime-day-picker-shell",
      );
      const city = root?.querySelector(citySelector);
      const actions = root?.querySelector(actionsSelector);
      const left = picker?.querySelector(".scroll-arrow--left");
      const right = picker?.querySelector(".scroll-arrow--right");

      const getVisibleRect = (element: Element | null | undefined) => {
        if (!element || getComputedStyle(element).display === "none") {
          return null;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? rect : null;
      };
      const intersectionArea = (
        first: DOMRect | null,
        second: DOMRect | null,
      ) => {
        if (!first || !second) {
          return 0;
        }

        return (
          Math.max(
            0,
            Math.min(first.right, second.right) -
              Math.max(first.left, second.left),
          ) *
          Math.max(
            0,
            Math.min(first.bottom, second.bottom) -
              Math.max(first.top, second.top),
          )
        );
      };

      return {
        leftCity: intersectionArea(getVisibleRect(left), getVisibleRect(city)),
        rightActions: intersectionArea(
          getVisibleRect(right),
          getVisibleRect(actions),
        ),
      };
    },
    { rootSelector, citySelector, actionsSelector },
  );

  expect(
    overlaps.leftCity,
    `Left arrow overlaps city at ${await page.title()}`,
  ).toBe(0);
  expect(
    overlaps.rightActions,
    `Right arrow overlaps controls at ${await page.title()}`,
  ).toBe(0);
}

test("all-showtimes date controls stay separate and clickable across widths", async ({
  page,
}) => {
  await page.goto("/showtimes");
  await expect(page.locator(".all-showtimes-day-picker-shell")).toBeVisible();

  for (const width of dayPickerWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(60);
    await expectControlsClearOfArrows(
      page,
      ".all-showtimes-day-picker-shell",
      ".all-showtimes-page-city, .cinema-showtimes-city-label",
      ".all-showtimes-day-picker-filter",
    );
    await expectVisibleDayCentersReachable(
      page,
      ".all-showtimes-day-picker-shell",
    );
  }

  await page.setViewportSize({ width: 320, height: 844 });
  const selectedBefore = await page
    .locator('.showtime-day-button[role="radio"][aria-checked="true"]')
    .getAttribute("aria-label");
  await page.getByRole("button", { name: "Next showtime date" }).click();
  await expect(
    page.locator('.showtime-day-button[role="radio"][aria-checked="true"]'),
  ).not.toHaveAttribute("aria-label", selectedBefore ?? "");

  const visibleDate = await page.evaluate(() => {
    const scroll = document.querySelector(
      ".all-showtimes-day-picker-shell .showtime-day-picker-scroll",
    );
    const scrollRect = scroll?.getBoundingClientRect();
    const buttons = Array.from(
      scroll?.querySelectorAll<HTMLButtonElement>(
        '.showtime-day-button[role="radio"]',
      ) ?? [],
    );

    if (!scrollRect) {
      return null;
    }

    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const rect = button.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2;
      const y = (rect.top + rect.bottom) / 2;
      const hit = document.elementFromPoint(x, y);

      if (
        x > scrollRect.left &&
        x < scrollRect.right &&
        y > scrollRect.top &&
        y < scrollRect.bottom &&
        hit?.closest('.showtime-day-button[role="radio"]') === button &&
        button.getAttribute("aria-checked") !== "true"
      ) {
        return { index, label: button.getAttribute("aria-label"), x, y };
      }
    }

    return null;
  });

  expect(visibleDate).not.toBeNull();
  if (!visibleDate) {
    return;
  }

  await page.mouse.click(visibleDate.x, visibleDate.y);
  await expect
    .poll(() =>
      page
        .locator('.showtime-day-button[role="radio"][aria-checked="true"]')
        .getAttribute("aria-label"))
    .toBe(visibleDate.label);
});

test("movie details date controls stay separate and clickable across widths", async ({
  page,
}) => {
  await page.goto("/D01");
  await expect(page.locator(".details-day-picker-shell")).toBeVisible();

  for (const width of dayPickerWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(60);
    await expectControlsClearOfArrows(
      page,
      ".details-day-picker-shell",
      ".details-day-picker-city",
      ".details-day-picker-actions",
    );
    await expectVisibleDayCentersReachable(page, ".details-day-picker-shell");
  }
});
