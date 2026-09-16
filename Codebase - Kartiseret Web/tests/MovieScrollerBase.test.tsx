import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MovieScrollerBase } from "../src/components/scroller/MovieScrollerBase";
import { sampleMovie } from "./fixtures";

function configureReducedMotion(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

describe("MovieScrollerBase virtualization and interaction", () => {
  it("keeps cards interactive immediately when reduced motion is requested", () => {
    configureReducedMotion(true);
    const onSelectMovie = vi.fn();
    const { container } = render(
      <MovieScrollerBase
        movieItems={[sampleMovie]}
        cardWidth={160}
        cardHeight={240}
        gap={12}
        onSelectMovie={onSelectMovie}
        getCardClassName={({ isVisible }) =>
          isVisible ? "is-visible" : "is-hidden"
        }
      />,
    );

    const card = screen
      .getAllByRole("button", { name: "Open Sample Movie details" })
      .find((element) => element.classList.contains("is-visible"));
    expect(card).toBeDefined();
    expect(card).toHaveClass("is-visible");
    expect(container.querySelector("section")).not.toHaveStyle({
      pointerEvents: "none",
    });
    fireEvent.click(card!);
    expect(onSelectMovie).toHaveBeenCalledWith(
      sampleMovie,
      { top: 0, left: 0, width: 0, height: 0 },
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("activates cards with keyboard input and ignores repeated key events", () => {
    configureReducedMotion(true);
    const onSelectMovie = vi.fn();
    render(
      <MovieScrollerBase
        movieItems={[sampleMovie]}
        onSelectMovie={onSelectMovie}
        getCardClassName={({ isVisible }) =>
          isVisible ? "is-visible" : "is-hidden"
        }
      />,
    );
    const card = screen
      .getAllByRole("button", { name: "Open Sample Movie details" })
      .find((element) => element.classList.contains("is-visible"));
    expect(card).toBeDefined();

    fireEvent.keyDown(card!, { key: "Enter", repeat: true });
    fireEvent.keyDown(card!, { key: "Escape" });
    expect(onSelectMovie).not.toHaveBeenCalled();
    fireEvent.keyDown(card!, { key: " " });
    expect(onSelectMovie).toHaveBeenCalledOnce();
  });

  it("applies scroll requests once and exposes custom card state styling", () => {
    configureReducedMotion(true);
    const onScrollRequestApplied = vi.fn();
    const { container, rerender } = render(
      <MovieScrollerBase
        movieItems={[
          sampleMovie,
          { ...sampleMovie, tmdbId: "202", title: "Second Movie" },
        ]}
        scrollRequest={{ scrollLeft: 240, nonce: 7 }}
        onScrollRequestApplied={onScrollRequestApplied}
        getCardStyle={({ isSelected }) => ({ opacity: isSelected ? 0.5 : 1 })}
        selectedItemIndex={0}
      />,
    );

    expect(onScrollRequestApplied).toHaveBeenCalledWith(7);
    expect(
      container.querySelector('[data-movie-scroller-item-index="0"]'),
    ).toHaveStyle({ opacity: "0.5" });
    rerender(
      <MovieScrollerBase
        movieItems={[]}
        scrollRequest={null}
        onScrollRequestApplied={onScrollRequestApplied}
      />,
    );
    expect(
      container.querySelectorAll("[data-movie-scroller-item-index]"),
    ).toHaveLength(0);
  });
});
