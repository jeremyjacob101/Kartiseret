import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { AttributionPage } from "../src/components/AttributionPage";
import { BottomBar } from "../src/components/bars/BottomBar";
import { MiniNavBar } from "../src/components/bars/MiniNavBar";

describe("static and portal-rendered surfaces", () => {
  it("keeps every attribution source link external and secure", () => {
    render(<AttributionPage />);

    expect(
      screen.getByRole("heading", { name: "Attribution" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(21);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    const tmdbLinks = screen.getAllByRole("link", { name: /TMDb/i });
    expect(tmdbLinks).toHaveLength(2);
    for (const link of tmdbLinks) {
      expect(link).toHaveAttribute("href", "https://www.themoviedb.org/");
    }
    for (const image of document.querySelectorAll("img")) {
      expect(image).toHaveAttribute("alt", "");
    }
  });

  it("renders footer navigation and preserves external profile security", () => {
    render(
      <MemoryRouter>
        <BottomBar />
      </MemoryRouter>,
    );

    expect(screen.getByText("©2026 Kartiseret")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Attribution" })).toHaveAttribute(
      "href",
      "/attribution",
    );
    expect(
      screen.getByRole("link", { name: "Jeremy Jacob on GitHub" }),
    ).toHaveAttribute("rel", "noreferrer");
    expect(
      screen.getByRole("link", { name: "Jeremy Jacob on LinkedIn" }),
    ).toHaveAttribute("target", "_blank");
  });

  it("portals the floating navigation and controls keyboard visibility", async () => {
    const user = userEvent.setup();
    const onHomeClick = vi.fn();
    const portalTarget = document.createElement("div");
    document.body.append(portalTarget);
    const { rerender } = render(
      <MiniNavBar
        actions={<button type="button">Search</button>}
        bottomOffset={18}
        isOverBottomBar
        isVisible={false}
        onHomeClick={onHomeClick}
        portalTarget={portalTarget}
        stackRef={{ current: null }}
      />,
    );

    expect(
      portalTarget.querySelector(".floating-navbar-stack"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(portalTarget.querySelector(".floating-home-button")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(portalTarget.querySelector(".floating-navbar-stack")).toHaveClass(
      "is-over-bottom-bar",
    );

    rerender(
      <MiniNavBar
        actions={<button type="button">Search</button>}
        bottomOffset={18}
        isOverBottomBar={false}
        isVisible
        onHomeClick={onHomeClick}
        portalTarget={portalTarget}
        stackRef={{ current: null }}
      />,
    );
    expect(portalTarget.querySelector(".floating-navbar-stack")).toHaveClass(
      "is-visible",
    );
    expect(portalTarget.querySelector(".floating-navbar-stack")).toHaveStyle(
      "--floating-navbar-dynamic-bottom: 18px",
    );
    await user.click(screen.getByRole("button", { name: "Go to homepage" }));
    expect(onHomeClick).toHaveBeenCalledOnce();
  });
});
