import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "../src/components/bars/Navbar";
import { useDeviceStore } from "../src/device/useDeviceType";

vi.mock("../src/components/MovieSearchMenu", () => ({
  MovieSearchMenu: ({ onOpen }: { onOpen: () => void }) => (
    <button type="button" aria-label="Open search" onClick={onOpen}>
      Search
    </button>
  ),
}));

vi.mock("../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: () => <button type="button">City selector</button>,
}));

vi.mock("../src/components/UserMenu", () => ({
  UserMenu: () => <button type="button">User menu</button>,
}));

function renderNavbar(path = "/movies") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Navbar
        catalogReady
        searchCollections={[]}
        settingsDisabled={false}
        onAllShowtimesNavClick={vi.fn()}
        onHomeClick={vi.fn()}
        onMoviesNavClick={vi.fn()}
        onSearchOpen={vi.fn()}
        onSelectResult={vi.fn()}
        onSettingsClick={vi.fn()}
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
      onAllShowtimesNavClick: vi.fn(),
      onHomeClick: vi.fn(),
      onMoviesNavClick: vi.fn(),
      onSearchOpen: vi.fn(),
      onSettingsClick: vi.fn(),
      onSoonsNavClick: vi.fn(),
    };
    render(
      <MemoryRouter initialEntries={["/movies"]}>
        <Navbar
          catalogReady
          searchCollections={[]}
          settingsDisabled={false}
          onSelectResult={vi.fn()}
          {...callbacks}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Now Playing" })).toHaveClass(
      "topnav-link--active",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Go to top of home page" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Now Playing" }));
    fireEvent.click(screen.getByRole("button", { name: "Coming Soon" }));
    fireEvent.click(screen.getByRole("button", { name: "All Showtimes" }));
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(callbacks.onHomeClick).toHaveBeenCalledOnce();
    expect(callbacks.onMoviesNavClick).toHaveBeenCalledOnce();
    expect(callbacks.onSoonsNavClick).toHaveBeenCalledOnce();
    expect(callbacks.onAllShowtimesNavClick).toHaveBeenCalledOnce();
    expect(callbacks.onSearchOpen).toHaveBeenCalledOnce();
    expect(callbacks.onSettingsClick).toHaveBeenCalledOnce();
  });

  it("prevents settings interaction when no account is available", () => {
    const onSettingsClick = vi.fn();
    render(
      <MemoryRouter>
        <Navbar
          catalogReady={false}
          searchCollections={[]}
          settingsDisabled
          onAllShowtimesNavClick={vi.fn()}
          onHomeClick={vi.fn()}
          onMoviesNavClick={vi.fn()}
          onSearchOpen={vi.fn()}
          onSelectResult={vi.fn()}
          onSettingsClick={onSettingsClick}
          onSoonsNavClick={vi.fn()}
        />
      </MemoryRouter>,
    );

    const button = screen.getByRole("button", {
      name: "Settings require an account",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Sign up or log in to use settings",
    );
    fireEvent.click(button);
    expect(onSettingsClick).not.toHaveBeenCalled();
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
