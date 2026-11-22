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
    ranking: {
      asOf: "2026-11-22",
      localReleaseDates: {},
      ticketedUpcomingIds: [],
    },
    ...overrides,
  };
}

function highlight(tmdbId: string, priority: number) {
  return {
    tmdbId,
    startsOn: "2026-11-19",
    endsOn: "2027-11-30",
    priority,
    label: null,
    enabled: true,
  } as const;
}

describe("homepage featured carousel", () => {
  afterEach(() => vi.useRealTimers());

  it("inserts the highest priority offer after the lead movie", () => {
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
      "Current Three",
      "Upcoming One",
      "Upcoming Three",
    ]);
    expect(slides[0]).toMatchObject({
      type: "movie",
      mode: "comingSoon",
      label: "Kids",
    });
  });

  it("ranks the six scheduled films using release timing, ticket availability and popularity", () => {
    const nowPlaying = [
      {
        ...movie("1", "The Hunger Games: Sunrise on the Reaping", "nowPlaying"),
        popularity: 80,
      },
      { ...movie("3", "You Can See Everything", "nowPlaying"), popularity: 5 },
      { ...movie("5", "How to Rob A Bank", "nowPlaying"), popularity: 30 },
    ];
    const comingSoon = [
      {
        ...movie("2", "Avengers Doomsday", "comingSoon"),
        releaseDate: "2026-12-22",
        popularity: 200,
      },
      {
        ...movie("4", "Dune Part Three", "comingSoon"),
        releaseDate: "2026-12-22",
        popularity: 75,
      },
      {
        ...movie("6", "Narnia the Magician’s Nephew", "comingSoon"),
        releaseDate: "2027-03-22",
        popularity: 60,
      },
      {
        ...movie("7", "Four years away", "comingSoon"),
        releaseDate: "2030-11-22",
        popularity: 1_000,
      },
    ];
    const config = featuredConfig({
      highlights: [
        highlight("1", 8),
        highlight("2", 10),
        highlight("3", 8),
        highlight("4", 10),
        highlight("5", 7),
        highlight("6", 10),
        highlight("7", 10),
      ],
      ranking: {
        asOf: "2026-11-22",
        localReleaseDates: {
          "1": "2026-11-20",
          "3": "2026-11-21",
          "5": "2026-11-18",
        },
        ticketedUpcomingIds: ["2", "4"],
      },
    });

    const rankedIds = (data: typeof config) =>
      buildHomepageFeaturedSlides(data, nowPlaying, comingSoon).flatMap((
        slide,
      ) => (slide.type === "movie" ? [slide.movie.tmdbId] : []));
    expect(rankedIds(config)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(
      rankedIds({
        ...config,
        ranking: { ...config.ranking!, ticketedUpcomingIds: [] },
      }),
    ).toEqual(["1", "3", "5", "2", "4", "6"]);
    expect(
      rankedIds({
        ...config,
        ranking: { ...config.ranking!, asOf: "2026-12-20" },
      }),
    ).toEqual(["2", "4", "1", "3", "5", "6"]);
  });

  it("deduplicates presales, then treats them as now playing on release day", () => {
    const now = movie("1", "Pre-sale in the now playing feed", "nowPlaying");
    const soon = movie("1", "Upcoming listing", "comingSoon");
    const config = featuredConfig({
      ranking: {
        asOf: "2026-11-22",
        localReleaseDates: {},
        ticketedUpcomingIds: ["1"],
      },
    });
    const slides = buildHomepageFeaturedSlides(config, [now], [soon]);
    expect(slides).toEqual([
      {
        type: "movie",
        movie: soon,
        mode: "comingSoon",
        label: null,
        ticketsOnSale: true,
      },
    ]);
    expect(
      buildHomepageFeaturedSlides(
        {
          ...config,
          ranking: { ...config.ranking!, asOf: "2026-12-01" },
        },
        [now],
        [soon],
      ),
    ).toEqual([
      {
        type: "movie",
        movie: now,
        mode: "nowPlaying",
        label: null,
        ticketsOnSale: true,
      },
    ]);
  });

  it("caps scheduled picks at six and keeps standalone offers", () => {
    const movies = Array.from({ length: 7 }, (_, index) =>
      movie(String(index + 1), `Movie ${index + 1}`, "nowPlaying"));
    const promotion = {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Cinema Day",
      body: "₪10 tickets",
      startsOn: "2026-11-19",
      endsOn: "2026-11-20",
      priority: 3,
      ctaLabel: null,
      ctaHref: null,
      enabled: true,
    };
    const config = featuredConfig({
      highlights: movies.map(({ tmdbId }, index) => highlight(tmdbId, index)),
      promotions: [promotion],
    });

    const slides = buildHomepageFeaturedSlides(config, movies, []);
    expect(slides).toHaveLength(7);
    expect(slides[0]).toMatchObject({ movie: { tmdbId: "7" } });
    expect(slides[1]).toEqual({ type: "promotion", promotion });
    expect(buildHomepageFeaturedSlides(config, [], [])).toEqual([
      { type: "promotion", promotion },
    ]);
  });

  it("fills from the current catalog, with stable ties and missing-data fallbacks", () => {
    const nowPlaying = Array.from({ length: 8 }, (_, index) => ({
      ...movie(String(8 - index), `Movie ${8 - index}`, "nowPlaying"),
      releaseDate: undefined,
      popularity: 0,
    }));
    nowPlaying[7] = { ...nowPlaying[7]!, movieCode: undefined };
    const upcoming = {
      ...movie("9", "Scheduled without a date", "comingSoon"),
      releaseDate: undefined,
    };
    const slides = buildHomepageFeaturedSlides(
      featuredConfig({
        highlights: [
          highlight("9", 10),
          { ...highlight("8", 100), enabled: false },
        ],
      }),
      nowPlaying,
      [upcoming],
    );

    expect(
      slides.map((slide) =>
        slide.type === "movie" ? slide.movie.tmdbId : null),
    ).toEqual(["2", "3", "4", "5", "6", "9"]);
  });

  it("slides by dot and keyboard, and restarts the five-second rotation after manual navigation", async () => {
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

    const carousel = screen.getByRole("region", {
      name: "Featured movies and cinema offers",
    });
    const frame = carousel.querySelector(".homepage-featured-frame")!;
    const dots = screen.getAllByRole("button", { name: /^Show featured item/ });
    expect(frame).toContainElement(dots[0]);
    expect(dots[0]).toHaveAttribute("aria-current", "true");
    expect(
      screen.queryByRole("button", { name: /^(Previous|Next) featured item$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /pause|play carousel/i }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "One" })).toBeVisible();

    await act(async () => vi.advanceTimersByTime(4_000));
    fireEvent.click(dots[1]!);
    expect(dots[1]).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "Cinema Day" })).toBeVisible();
    expect(frame.querySelector('[data-motion="outgoing"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(frame).toHaveAttribute("data-direction", "forward");

    await act(async () => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("heading", { name: "Cinema Day" })).toBeVisible();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByRole("heading", { name: "Two" })).toBeVisible();

    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(frame).toHaveAttribute("data-direction", "backward");
    expect(screen.getByRole("heading", { name: "Cinema Day" })).toBeVisible();
    fireEvent.click(dots[0]!);
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(dots.at(-1)).toHaveAttribute("aria-current", "true");
    expect(dots[0]).not.toHaveAttribute("aria-current");

    fireEvent.pointerEnter(carousel);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(dots.at(-1)).toHaveAttribute("aria-current", "true");
    fireEvent.pointerLeave(carousel);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(dots[0]).toHaveAttribute("aria-current", "true");
  });

  it("lets admins edit a legacy highlight with a clamped rating", async () => {
    const legacy = highlight("1", 50);
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <HomepageFeaturedCarousel
        config={featuredConfig({ highlights: [legacy] })}
        nowPlayingMovies={[movie("1", "One", "nowPlaying")]}
        comingSoonMovies={[]}
        isAdmin
        userId="admin"
        homepageHighlights={[legacy]}
        onAdminSaveHomepageHighlight={save}
        onAdminRemoveHomepageHighlight={async () => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit highlight" }));
    const rating = screen.getByRole("spinbutton", { name: "Feature rating" });
    expect(rating).toHaveValue(10);
    expect(rating).toHaveAttribute("min", "0");
    expect(rating).toHaveAttribute("max", "10");
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Save highlight" })));
    expect(save).toHaveBeenCalledWith({ ...legacy, priority: 10 });
  });
});
