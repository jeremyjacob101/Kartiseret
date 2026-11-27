import { PublicRoutePathsProvider } from "../../src/routing/PublicRoutePathsProvider";
import SiteInformation from "../../src/components/legal/SiteInformation";
import { siteInformationPages } from "../../src/routing/siteInformation";
import { BottomBar } from "../../src/components/bars/BottomBar";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

describe("site information", () => {
  it("preserves source attribution, secure provider links and rights contacts", () => {
    const credits = siteInformationPages.find(
      ({ path }) => path === "/attribution",
    )!;
    render(
      <MemoryRouter>
        <PublicRoutePathsProvider
          paths={{ "/third-party-licenses.txt": "/license1" }}
        >
          <SiteInformation page={credits} />
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Credits", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      ),
    ).toBeInTheDocument();
    const providers = Array.from(
      document.querySelectorAll(".site-info-sources a"),
    );
    expect(providers).toHaveLength(20);
    for (const link of providers) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(link.querySelector("img")).toHaveAttribute("alt", "");
    }
    expect(screen.getByRole("link", { name: "TMDb" })).toHaveAttribute(
      "href",
      "https://www.themoviedb.org/",
    );
    expect(
      screen.getByRole("link", { name: "third-party software notices" }),
    ).toHaveAttribute("href", "/license1");
    expect(
      screen.getByRole("link", { name: "jeremyjacob101@gmail.com" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:jeremyjacob101@gmail.com"),
    );
  });

  it("explains browser storage, analytics, and Israeli privacy rules", () => {
    const privacy = siteInformationPages.find(
      ({ path }) => path === "/privacy",
    )!;
    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <SiteInformation page={privacy} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/uses sign-in cookies/)).toHaveTextContent(
      "can sign you out and reset these local choices",
    );
    expect(
      screen.getByText(/Vercel Web Analytics measures visits/),
    ).toHaveTextContent("It uses no analytics cookies.");
    expect(
      screen.getByText(/YouTube’s privacy-enhanced player/),
    ).toHaveTextContent(
      "Some Coming Soon movie details can load the YouTube player before you press Play.",
    );
    expect(screen.getByText(/Web sessions expire 30 days/)).toBeVisible();

    const privacyRules = within(
      screen.getByRole("region", { name: "Israeli privacy rules" }),
    );
    expect(
      privacyRules.getByText(/apply Israel’s Privacy Protection Law/),
    ).toBeVisible();
    expect(privacyRules.getByText(/Analytics by default/)).toBeVisible();
    expect(
      privacyRules.getByText(/apply that guidance with users in mind/),
    ).toBeVisible();
    expect(
      privacyRules.getByText(/glad to hear from anyone/),
    ).toHaveTextContent("access, correct, or delete personal information");
    expect(
      privacyRules.getByRole("link", { name: "jeremyjacob101@gmail.com" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:jeremyjacob101@gmail.com"),
    );
    expect(
      privacyRules.getByRole("link", {
        name: "Privacy Protection Law in Hebrew",
      }),
    ).toHaveAttribute(
      "href",
      "https://main.knesset.gov.il/apps-lgs/legislation/main/laws/2000234",
    );
    expect(
      privacyRules.getByRole("link", { name: /guidance on consent/ }),
    ).toHaveAttribute("href", "https://www.gov.il/he/pages/consent-2026");
  });

  it.each([
    ["2026-12-31T21:59:59Z", "2026"],
    ["2026-12-31T22:00:00Z", "2027"],
  ])("renders the Israeli calendar year at %s", (instant, year) => {
    vi.setSystemTime(new Date(instant));
    try {
      render(
        <MemoryRouter>
          <BottomBar />
        </MemoryRouter>,
      );

      expect(screen.getByText(`©${year} Kartiseret`)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists the five footer destinations and marks only the current page", () => {
    render(
      <MemoryRouter initialEntries={["/privacy"]}>
        <PublicRoutePathsProvider
          paths={{
            "/support": "/suppor1a",
            "/accessibility": "/accessi1",
            "/privacy": "/privac01",
            "/terms": "/terms001",
            "/attribution": "/credits1",
          }}
        >
          <BottomBar />
        </PublicRoutePathsProvider>
      </MemoryRouter>,
    );

    const footerNavigation = within(
      screen.getByRole("navigation", { name: "Footer" }),
    );
    expect(
      footerNavigation
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Support", "/suppor1a"],
      ["Accessibility", "/accessi1"],
      ["Privacy", "/privac01"],
      ["Terms of Use", "/terms001"],
      ["Credits", "/credits1"],
    ]);
    expect(
      footerNavigation.getByRole("link", { name: "Privacy", current: "page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Jeremy Jacob on GitHub" }),
    ).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByRole("link", { name: "Jeremy Jacob on LinkedIn" }),
    ).toHaveAttribute("target", "_blank");
  });
});
