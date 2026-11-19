import { MovieScroller } from "../../src/components/scroller/MovieScroller";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../../src/data/movieCatalog";
import { render } from "@testing-library/react";
import { sampleMovie } from "../fixtures";

afterEach(() => vi.restoreAllMocks());

function movies(prefix: string, count: number): Movie[] {
  return Array.from({ length: count }, (_, index) => ({
    ...sampleMovie,
    tmdbId: String(1000 + index),
    title: `${prefix} ${index}`,
    imageSrc: `/${prefix}-${index}.jpg`,
  }));
}

describe("MovieScroller catalog updates", () => {
  it("keeps the opening movie anchored when the catalog length changes", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    const queryClient = new QueryClient();
    const oldMovies = movies("Cached movie", 8);
    const newMovies = movies("Fresh movie", 12);
    const renderScroller = (movieItems: Movie[]) => (
      <QueryClientProvider client={queryClient}>
        <MovieScroller
          mode="comingSoon"
          movieItems={movieItems}
          cardWidth={220}
          cardHeight={330}
          gap={22}
        />
      </QueryClientProvider>
    );

    const { container, rerender, unmount } = render(renderScroller(oldMovies));
    rerender(renderScroller(newMovies));

    const visibleTitles = [
      ...container.querySelectorAll<HTMLElement>(".movie-scroller-card"),
    ]
      .filter((card) => Number(card.style.opacity) > 0)
      .map((card) => card.getAttribute("aria-label"));

    expect(visibleTitles).toContain("Open Fresh movie 0 details");

    unmount();
    queryClient.clear();
  });
});
