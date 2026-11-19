import type { HomepageFeaturedResponse } from "@kartiseret/contracts/homepage-featured";
import { HomepageFeaturedCarousel } from "../src/components/HomepageFeaturedCarousel";
import { buildHomepageFeaturedSlides } from "../src/data/homepageFeaturedSlides";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Movie } from "../src/data/movieCatalog";
import { sampleMovie } from "./fixtures";

function movie(
  id: string,
  title: string,
  mode: "nowPlaying" | "comingSoon",
): Movie {
  return {
    ...sampleMovie,
    tmdbId: id,
    title,
    movieCode: `${id.slice(-2)}x`,
    backdropSrc: `/backdrops/${id}.jpg`,
    releaseDate: mode === "comingSoon" ? "2026-12-01" : sampleMovie.releaseDate,
  };
}

function featuredConfig(
  overrides: Partial<HomepageFeaturedResponse["data"]> = {},
): HomepageFeaturedResponse["data"] {
  return {
    lineup: {
      weekStart: "2026-11-19",
      nowPlayingIds: ["1", "2", "3"],
      comingSoonIds: ["4", "5", "6"],
    },
    highlights: [],
    promotions: [],
    ...overrides,
  };
}

describe("homepage featured carousel", () => {
  afterEach(() => vi.useRealTimers());

  it("uses admin picks first and inserts the highest priority promotion after the lead", () => {
    const nowPlaying = [
      movie("1", "Current One", "nowPlaying"),
      movie("2", "Current Two", "nowPlaying"),
      movie("3", "Current Three", "nowPlaying"),
    ];
    const comingSoon = [
      movie("4", "Upcoming One", "comingSoon"),
      movie("5", "Upcoming Two", "comingSoon"),
      movie("6", "Upcoming Three", "comingSoon"),
    ];
    const config = featuredConfig({
      highlights: [
        {
          tmdbId: "5",
          startsOn: "2026-11-19",
          endsOn: "2026-11-30",
          priority: 10,
          label: "kids",
          enabled: true,
        },
      ],
      promotions: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "Cinema Day",
          body: "₪10 tickets",
          startsOn: "2026-11-19",
          endsOn: "2026-11-20",
          priority: 3,
          ctaLabel: null,
          ctaHref: null,
          enabled: true,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          title: "Lower priority",
          body: "More",
          startsOn: "2026-11-19",
          endsOn: "2026-11-20",
          priority: 1,
          ctaLabel: null,
          ctaHref: null,
          enabled: true,
        },
      ],
    });

    const slides = buildHomepageFeaturedSlides(config, nowPlaying, comingSoon);

    expect(
      slides.map((slide) =>
        slide.type === "movie" ? slide.movie.title : slide.promotion.title),
    ).toEqual([
      "Upcoming Two",
      "Cinema Day",
      "Current One",
      "Current Two",
      "Upcoming One",
      "Current Three",
    ]);
    expect(slides[0]).toMatchObject({
      type: "movie",
      mode: "comingSoon",
      label: "Kids",
    });
  });

  it("falls back to the current catalog, skips movies without a page, and limits movie slides to five", () => {
    const nowPlaying = Array.from({ length: 7 }, (_, index) =>
      movie(String(index + 1), `Movie ${index + 1}`, "nowPlaying"));
    nowPlaying[6] = { ...nowPlaying[6]!, movieCode: undefined };
    const slides = buildHomepageFeaturedSlides(
      featuredConfig({ lineup: null }),
      nowPlaying,
      [],
    );

    expect(slides).toHaveLength(5);
    expect(
      slides.every(
        (slide) => slide.type === "movie" && slide.mode === "nowPlaying",
      ),
    ).toBe(true);
  });

  it("loops through items, supports dot navigation, and stops rotation when paused", async () => {
    vi.useFakeTimers();
    const config = featuredConfig({
      promotions: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "Cinema Day",
          body: "Tickets for ₪10",
          startsOn: "2026-11-19",
          endsOn: "2026-11-20",
          priority: 1,
          ctaLabel: null,
          ctaHref: null,
          enabled: true,
        },
      ],
    });
    const nowPlaying = [
      movie("1", "One", "nowPlaying"),
      movie("2", "Two", "nowPlaying"),
    ];
    const comingSoon = [
      movie("4", "Four", "comingSoon"),
      movie("5", "Five", "comingSoon"),
    ];
    render(
      <HomepageFeaturedCarousel
        config={config}
        nowPlayingMovies={nowPlaying}
        comingSoonMovies={comingSoon}
        isAdmin={false}
        userId={null}
        homepageHighlights={[]}
        onAdminSaveHomepageHighlight={async () => undefined}
        onAdminRemoveHomepageHighlight={async () => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "One" })).toBeVisible();
    const dots = screen.getAllByRole("button", { name: /^Show featured item/ });
    fireEvent.click(dots[1]!);
    expect(screen.getByRole("heading", { name: "Cinema Day" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pause carousel" }));
    await act(async () => {
      vi.advanceTimersByTime(ROTATION_TEST_INTERVAL);
    });
    expect(screen.getByRole("heading", { name: "Cinema Day" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play carousel" }));
    await act(async () => {
      vi.advanceTimersByTime(ROTATION_TEST_INTERVAL);
    });
    expect(screen.getByRole("heading", { name: "Two" })).toBeVisible();
  });
});

const ROTATION_TEST_INTERVAL = 7_000;
