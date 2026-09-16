import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PosterGridPage } from "../src/components/PosterGridPage";
import type { Movie } from "../src/data/movieCatalog";

function createMovie(): Movie {
  return {
    tmdbId: "101",
    movieCode: "Ab1",
    title: "Original Movie",
    year: 2026,
    genres: ["Drama"],
    imageSrc: "/original.jpg",
    imdbRating: null,
    lbRating: null,
    lbVotes: null,
    tmdbRating: null,
    tmdbVotes: null,
    rtCriticRating: null,
    rtCriticVotes: null,
    rtAudienceRating: null,
    rtAudienceVotes: null,
    runtime: 100,
    popularity: 10,
    altOptions: [
      {
        tmdbId: "202",
        title: "Mapped Alternative",
        year: 2027,
        posterUrl: "/alternative.jpg",
      },
    ],
  };
}

describe("PosterGridPage", () => {
  it("opens selected movies from the grid and keeps the tile accessible", async () => {
    const user = userEvent.setup();
    const onPosterSelect = vi.fn();
    const movie = createMovie();
    render(
      <PosterGridPage
        title="Now Playing"
        movies={[movie]}
        onPosterSelect={onPosterSelect}
      />,
    );

    const tile = screen.getByRole("button", {
      name: "Open Original Movie in scroller view",
    });
    expect(tile).toHaveAttribute("title", "Original Movie");
    await user.click(tile);
    expect(onPosterSelect).toHaveBeenCalledWith(movie);
  });

  it("saves a selected admin mapping and exposes the post-save refresh action", async () => {
    const user = userEvent.setup();
    const onAdminSaveEdit = vi.fn().mockResolvedValue(undefined);
    const onRefreshRequested = vi.fn().mockResolvedValue(undefined);
    render(
      <PosterGridPage
        title="Now Playing"
        movies={[createMovie()]}
        onPosterSelect={vi.fn()}
        isAdmin
        onAdminSaveEdit={onAdminSaveEdit}
        onRefreshRequested={onRefreshRequested}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit mapping for Original Movie" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit Original Movie" }),
    ).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    await user.click(radios[1]!);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onAdminSaveEdit).toHaveBeenCalledWith({
        currentTmdbId: "101",
        selectedTmdbId: "202",
        selectedTitle: "Mapped Alternative",
        selectedYear: 2027,
        selectedPosterUrl: "https://image.tmdb.org/t/p/w342/alternative.jpg",
        isManualEntry: false,
      }));
    expect(
      screen.getByRole("button", { name: "Refresh data" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh data" }));
    await waitFor(() => expect(onRefreshRequested).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("validates and normalizes manual TMDB ids", async () => {
    const user = userEvent.setup();
    const onAdminSaveEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <PosterGridPage
        title="Now Playing"
        movies={[createMovie()]}
        onPosterSelect={vi.fn()}
        isAdmin
        onAdminSaveEdit={onAdminSaveEdit}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit mapping for Original Movie" }),
    );
    const manualInput = screen.getByPlaceholderText("e.g. 693134");
    await user.type(manualInput, "abc-0042x");
    expect(manualInput).toHaveValue("0042");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onAdminSaveEdit).toHaveBeenCalledWith({
        currentTmdbId: "101",
        selectedTmdbId: "42",
        selectedTitle: null,
        selectedYear: null,
        selectedPosterUrl: null,
        isManualEntry: true,
      }));
  });

  it("keeps the modal open on save and refresh failures so the admin can recover", async () => {
    const user = userEvent.setup();
    const onAdminSaveEdit = vi.fn().mockRejectedValue(new Error("Save failed"));
    render(
      <PosterGridPage
        title="Now Playing"
        movies={[createMovie()]}
        onPosterSelect={vi.fn()}
        isAdmin
        onAdminSaveEdit={onAdminSaveEdit}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit mapping for Original Movie" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
