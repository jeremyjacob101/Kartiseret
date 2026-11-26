import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useDeviceStore } from "../../src/device/useDeviceType";
import { Navbar } from "../../src/components/bars/Navbar";
import { MemoryRouter } from "react-router";

vi.mock("../../src/components/MovieSearchMenu", () => ({
  MovieSearchMenu: ({ onOpen }: { onOpen: () => void }) => (
    <button type="button" aria-label="Open search" onClick={onOpen}>
      Search
    </button>
  ),
}));

vi.mock("../../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: () => <button type="button">City selector</button>,
}));

vi.mock("../../src/components/UserMenu", () => ({
  UserMenu: () => <button type="button">User menu</button>,
}));

function renderNavbar(path = "/movies") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navbar
        catalogReady
        searchCollections={[]}
        onHomeClick={vi.fn()}
        onMoviesNavClick={vi.fn()}
        onSearchOpen={vi.fn()}
        onSelectResult={vi.fn()}
        onSoonsNavClick={vi.fn()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useDeviceStore.setState({
    deviceType: "desktop",
    isMobile: false,
    isDesktop: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Navbar", () => {
  it("marks the active catalog route and wires every primary action", () => {
    const callbacks = {
      onHomeClick: vi.fn(),
      onMoviesNavClick: vi.fn(),
      onSearchOpen: vi.fn(),
      onSoonsNavClick: vi.fn(),
    };
    render(
      <MemoryRouter initialEntries={["/movies"]}>
        <Navbar
          catalogReady
          searchCollections={[]}
          onSelectResult={vi.fn()}
          {...callbacks}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Now Playing" })).toHaveClass(
      "topnav-link--active",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Go to top of home page" }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Now Playing" }));
    fireEvent.click(screen.getByRole("link", { name: "Coming Soon" }));
    fireEvent.click(screen.getByRole("link", { name: "All Showtimes" }));
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));

    expect(
      screen.queryByRole("button", { name: /settings/i }),
    ).not.toBeInTheDocument();
    expect(callbacks.onHomeClick).toHaveBeenCalledOnce();
    expect(callbacks.onMoviesNavClick).toHaveBeenCalledOnce();
    expect(callbacks.onSoonsNavClick).toHaveBeenCalledOnce();
    expect(callbacks.onSearchOpen).toHaveBeenCalledOnce();
  });

  it("ends the intro transition on schedule", () => {
    vi.useFakeTimers();
    renderNavbar();
    expect(document.querySelector(".navbar")).toHaveClass("is-intro");

    act(() => {
      vi.advanceTimersByTime(759);
    });
    expect(document.querySelector(".navbar")).toHaveClass("is-intro");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.querySelector(".navbar")).not.toHaveClass("is-intro");
  });
});
