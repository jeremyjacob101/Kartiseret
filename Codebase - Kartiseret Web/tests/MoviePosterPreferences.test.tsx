import { MoviePosterArtwork } from "../src/components/MoviePosterArtwork";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { preference } = vi.hoisted(() => ({
  preference: {
    tmdbId: "101",
    title: "Sensitive Poster",
    releaseYear: 2026,
    treatment: "standard" as const,
    hideBackdrop: true,
  },
}));

vi.mock("../src/contexts/MovieDisplayPreferencesContext", () => ({
  useMovieDisplayPreferences: () => ({
    preferencesById: new Map([[preference.tmdbId, preference]]),
    ready: true,
    error: null,
  }),
}));

describe("MoviePosterArtwork with personal display preferences", () => {
  it("does not request source art for a title using the Kartiseret poster", () => {
    render(
      <MoviePosterArtwork
        title={preference.title}
        tmdbId={preference.tmdbId}
        imageSrc="/source-poster.jpg"
      />,
    );

    expect(screen.getByText(preference.title)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      document.querySelector('img[src="/source-poster.jpg"]'),
    ).not.toBeInTheDocument();
  });
});
