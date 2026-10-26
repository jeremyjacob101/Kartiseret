import { MovieSearchMenu } from "../src/components/MovieSearchMenu";
import { render, screen, waitFor } from "@testing-library/react";
import type { Movie } from "../src/data/movieCatalog";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sampleMovie } from "./fixtures";

function movie(overrides: Partial<Movie>): Movie {
  return { ...sampleMovie, ...overrides };
}

const collections = [
  {
    mode: "nowPlaying" as const,
    label: "Now Playing",
    movies: [sampleMovie],
  },
  {
    mode: "comingSoon" as const,
    label: "Coming Soon",
    movies: [
      movie({
        tmdbId: "102",
        title: "Another Sample",
        year: 2027,
        movieCode: "Cd2",
      }),
    ],
  },
];

describe("MovieSearchMenu", () => {
  it("opens, focuses, ranks results, and returns the selected movie", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onSelectResult = vi.fn();
    render(
      <MovieSearchMenu
        collections={collections}
        onOpen={onOpen}
        onSelectResult={onSelectResult}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Search movies" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const input = screen.getByRole("searchbox");
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "sample");

    const results = screen.getAllByRole("button", { name: /Sample/ });
    expect(results[0]).toHaveAccessibleName(/Sample Movie/);
    expect(screen.getByText("Now Playing • 2026")).toBeInTheDocument();
    await user.click(results[0]);

    expect(onSelectResult).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: "101",
        title: "Sample Movie",
        mode: "nowPlaying",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes loading, empty, escape, and outside-click states", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MovieSearchMenu collections={[]} loading onSelectResult={vi.fn()} />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Search movies" }));
    expect(
      screen.getByText("Type a movie title to search."),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "unknown");
    expect(screen.getByText("Loading movie library...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search movies" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
