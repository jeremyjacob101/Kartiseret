import { MoviePosterArtwork } from "../src/components/MoviePosterArtwork";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("MoviePosterArtwork", () => {
  it("keeps its image element and fallback while an offscreen request is deferred", () => {
    const props = {
      title: "Deferred",
      imageSrc: "/deferred.jpg",
      showFallbackWhileLoading: true,
    };
    const { rerender } = render(<MoviePosterArtwork {...props} deferRequest />);
    const image = screen.getByRole("img", { name: "Deferred" });
    expect(image).not.toHaveAttribute("src");
    expect(screen.getByText("Deferred")).toBeInTheDocument();
    rerender(<MoviePosterArtwork {...props} deferRequest={false} />);
    expect(screen.getByRole("img", { name: "Deferred" })).toBe(image);
    expect(image).toHaveAttribute("src", "/deferred.jpg");
    fireEvent.load(image);
    expect(screen.queryByText("Deferred")).not.toBeInTheDocument();
  });
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
