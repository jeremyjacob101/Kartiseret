import { MoviePosterArtwork } from "../../src/components/MoviePosterArtwork";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("MoviePosterArtwork", () => {
  it("selects responsive R2 variants for catalog poster URLs", () => {
    render(
      <MoviePosterArtwork
        title="Responsive"
        imageSrc={`https://seret.site/api/images/v1/poster/${"a".repeat(64)}/342.webp`}
      />,
    );
    const image = screen.getByRole("img", { name: "Responsive" });
    expect(image.getAttribute("srcSet")).toContain("185.webp 185w");
    expect(image.getAttribute("srcSet")).toContain("780.webp 780w");
    expect(image).toHaveAttribute("sizes", "300px");
  });

  it("uses the responsive set supplied by the catalog API", () => {
    const supplied =
      "https://images.example/185.webp 185w, https://images.example/342.webp 342w";
    render(
      <MoviePosterArtwork
        title="API variants"
        imageSrc="https://seret.site/api/images/v1/poster/hash/342.webp"
        imageSrcSet={supplied}
      />,
    );
    expect(screen.getByRole("img", { name: "API variants" })).toHaveAttribute(
      "srcSet",
      supplied,
    );
  });

  it("uses the measured slot size when a page provides one", () => {
    render(
      <MoviePosterArtwork
        title="Compact alert"
        imageSrc={`/api/images/v1/poster/${"b".repeat(64)}/342.webp`}
        imageSizes="42px"
      />,
    );
    expect(screen.getByRole("img", { name: "Compact alert" })).toHaveAttribute(
      "sizes",
      "42px",
    );
  });

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
    expect(image).not.toHaveStyle({ opacity: "0" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("draggable", "true");
    expect(image).toHaveAttribute("data-image-status", "loading");

    fireEvent.load(image);
    expect(screen.queryByText("Loading Movie")).not.toBeInTheDocument();
    expect(image).toHaveAttribute("data-image-status", "loaded");
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
    expect(image).toHaveAttribute("data-image-status", "error");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Broken Movie").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
