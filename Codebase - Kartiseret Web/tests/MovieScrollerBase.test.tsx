import { backdropPreloader, createBackdropPreloader } from "../src/components/scroller/backdropPreloader";
import { MovieScrollerBase } from "../src/components/scroller/MovieScrollerBase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "@testing-library/react";
import { sampleMovie } from "./fixtures";

afterEach(() => vi.useRealTimers());

// Each test supplies a fresh fake browser image cache.
beforeEach(() => Object.assign(backdropPreloader, createBackdropPreloader()));

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
  it("withholds offscreen sources and promotes them immediately after scrolling", async () => {
    configureReducedMotion(true);
    vi.useFakeTimers();
    const images: { src: string; fetchPriority: string }[] = [];
    vi.stubGlobal(
      "Image",
      class {
        complete = false;
        src = "";
        fetchPriority = "";
        constructor() {
          images.push(this);
        }
      },
    );
    const movies = Array.from({ length: 30 }, (_, index) => ({
      ...sampleMovie,
      tmdbId: String(index),
      title: `Movie ${index}`,
      imageSrc: `/poster-${index}.jpg`,
      backdropSrc: `/backdrop-${index}.jpg`,
    }));
    const { container, unmount } = render(
      <MovieScrollerBase movieItems={movies} />,
    );
    const withheld = [
      ...container.querySelectorAll<HTMLImageElement>("img:not([src])"),
    ];
    expect(withheld.length).toBeGreaterThan(0);
    const withheldSources = withheld.map((image) => {
      const index = Number(
        image
          .closest("[data-movie-scroller-item-index]")
          ?.getAttribute("data-movie-scroller-item-index"),
      );
      return movies[index % movies.length].imageSrc;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(images.every((image) => image.fetchPriority === "high")).toBe(true);
    expect(images.some((image) => withheldSources.includes(image.src))).toBe(
      false,
    );
    const scroller = container.querySelector("section")!;
    await act(async () => {
      scroller.scrollLeft += 242 * 5;
      fireEvent.scroll(scroller);
      await vi.advanceTimersByTimeAsync(40);
    });
    expect(
      images.some(
        (image) =>
          withheldSources.includes(image.src) && image.fetchPriority === "high",
      ),
    ).toBe(true);
    unmount();
  });
  it("keeps scheduler-started offscreen poster elements at low priority", async () => {
    configureReducedMotion(true);
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        naturalWidth = 100;
        src = "";
        fetchPriority = "";
      },
    );
    const movies = Array.from({ length: 30 }, (_, index) => ({
      ...sampleMovie,
      tmdbId: String(index),
      title: `Movie ${index}`,
      imageSrc: `/poster-${index}.jpg`,
      backdropSrc: `/backdrop-${index}.jpg`,
    }));
    const { container } = render(<MovieScrollerBase movieItems={movies} />);
    const withheldSources = [
      ...container.querySelectorAll<HTMLImageElement>("img:not([src])"),
    ].map((image) => {
      const index = Number(
        image
          .closest("[data-movie-scroller-item-index]")
          ?.getAttribute("data-movie-scroller-item-index"),
      );
      return movies[index % movies.length].imageSrc;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const scheduledPoster = [
      ...container.querySelectorAll<HTMLImageElement>("img[src]"),
    ].find((image) =>
      withheldSources.includes(image.getAttribute("src") ?? ""));
    expect(scheduledPoster).toBeDefined();
    expect(scheduledPoster?.getAttribute("fetchpriority")).toBe("low");
  });

  it("retains the entrance timing and warms backdrops only after it finishes", async () => {
    configureReducedMotion(false);
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        src = "";
        decoding = "";
        fetchPriority = "";
      },
    );
    const cancel = vi.fn();
    const warm = vi
      .spyOn(backdropPreloader, "warmBackdrops")
      .mockReturnValue(cancel);
    const { container, unmount } = render(
      <MovieScrollerBase movieItems={[sampleMovie]} onSelectMovie={() => {}} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(warm).not.toHaveBeenCalled();
    expect(container.querySelector("section")).toHaveStyle({
      pointerEvents: "none",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1450);
    });
    expect(warm).toHaveBeenCalledWith([sampleMovie.backdropSrc]);
    expect(container.querySelector("section")).not.toHaveStyle({
      pointerEvents: "none",
    });
    unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("registers critical poster readiness even when the entrance image timeout fires", async () => {
    configureReducedMotion(false);
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        complete = false;
        src = "";
        decoding = "";
        fetchPriority = "";
      },
    );
    const protect = vi.spyOn(backdropPreloader, "protectPosters");
    const warm = vi
      .spyOn(backdropPreloader, "warmBackdrops")
      .mockReturnValue(() => {});
    render(
      <MovieScrollerBase movieItems={[sampleMovie]} onSelectMovie={() => {}} />,
    );
    let ready = false;
    void protect.mock.calls[0][1].then(() => {
      ready = true;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2800);
    });
    expect(warm).toHaveBeenCalledWith([sampleMovie.backdropSrc]);
    expect(ready).toBe(false);
    expect(protect).toHaveBeenCalledWith(
      [sampleMovie.imageSrc],
      expect.any(Promise),
    );
  });

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
