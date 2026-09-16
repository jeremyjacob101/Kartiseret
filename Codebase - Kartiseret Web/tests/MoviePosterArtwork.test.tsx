import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoviePosterArtwork } from "../src/components/MoviePosterArtwork";

describe("MoviePosterArtwork", () => {
  it("renders an accessible title fallback when no poster exists", () => {
    render(
      <MoviePosterArtwork
        title="Fallback Movie"
        className="poster"
        fallbackClassName="fallback"
      />,
    );

    expect(screen.getByText("Fallback Movie")).toHaveClass(
      "movie-poster-fallback-title",
    );
    expect(screen.getByText("Fallback Movie").parentElement).toHaveClass(
      "poster",
      "fallback",
    );
  });

  it("keeps a loading fallback visible until the image resolves", () => {
    render(
      <MoviePosterArtwork
        title="Loading Movie"
        imageSrc="/posters/loading.jpg"
        alt="Loading Movie poster"
        showFallbackWhileLoading
        loading="lazy"
        draggable
      />,
    );

    const image = screen.getByRole("img", { name: "Loading Movie poster" });
    expect(screen.getByText("Loading Movie")).toBeInTheDocument();
    expect(image).toHaveStyle({ opacity: "0" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("draggable", "true");

    fireEvent.load(image);
    expect(screen.queryByText("Loading Movie")).not.toBeInTheDocument();
    expect(image).not.toHaveStyle({ opacity: "0" });
  });

  it("restores the fallback after an image error and supports decorative posters", () => {
    render(
      <MoviePosterArtwork
        title="Broken Movie"
        imageSrc="/posters/broken.jpg"
        alt=""
        showFallbackWhileLoading
      />,
    );

    const image = document.querySelector('img[src="/posters/broken.jpg"]');
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);
    expect(screen.getByText("Broken Movie")).toBeInTheDocument();
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Broken Movie").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
