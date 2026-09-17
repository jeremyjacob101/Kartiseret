import { cloneShowtimeDays, extractYouTubeVideoKey, findShowtimePanel, formatReleaseDate, formatRuntime, getFirstShowtimeDate, getMetricDisplays, getMovieInfoParts, getNearestShowtimeDate, getScrollBehavior, getShowtimeDateLabel, getShowtimeTargetDate, getTrailerEmbedUrl } from "../src/components/showtimes/showtimeUtils";
import { addCalendarDays } from "../src/routing/showtimeLinkCodec";
import { fixedAppDateString } from "../src/data/movieCatalog";
import { sampleMovie, sampleShowtimeDays } from "./fixtures";
import { describe, expect, it, vi } from "vitest";

describe("showtime presentation utilities", () => {
  it("formats movie runtime, metadata, and release dates", () => {
    expect(formatRuntime(45)).toBe("45m");
    expect(formatRuntime(125)).toBe("2h 5m");
    expect(getMovieInfoParts(sampleMovie)).toEqual(["2026", "2h 5m"]);
    expect(formatReleaseDate("2026-09-18")).toMatch(/September 18, 2026/);
    expect(formatReleaseDate("not-a-date")).toBe("not-a-date");
  });

  it("recognizes direct keys and supported YouTube URL formats only", () => {
    expect(extractYouTubeVideoKey("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoKey("https://youtu.be/dQw4w9WgXcQ?t=4")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractYouTubeVideoKey("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    ).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeVideoKey("https://example.test/video")).toBeNull();
    expect(getTrailerEmbedUrl(sampleMovie.trailerKey)).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1",
    );
    expect(getTrailerEmbedUrl("short")).toBeNull();
  });

  it("creates the correct rating metrics and accessibility labels", () => {
    const metrics = getMetricDisplays(sampleMovie, [
      "imdbRating",
      "rtCriticRating",
      "rtAudienceRating",
      "lbRating",
      "tmdbRating",
    ]);

    expect(metrics.map((metric) => metric.value)).toEqual([
      "8.3",
      "80%",
      "92%",
      "4.2",
      "8.3",
    ]);
    expect(metrics[1]?.logoSrc).toBe("/logos/rtCriticHot.svg");
    expect(metrics[2]?.logoSrc).toBe("/logos/rtAudienceHot.svg");
    expect(metrics[0]?.href).toContain("imdb.com/title/tt1234567");
    expect(metrics[3]?.href).toBe("https://letterboxd.com/film/sample-movie/");
  });

  it("chooses showtime dates without losing a valid user preference", () => {
    expect(getShowtimeDateLabel(fixedAppDateString)).toBe("Today");
    expect(getShowtimeDateLabel(addCalendarDays(fixedAppDateString, 1)!)).toBe(
      "Tomorrow",
    );
    expect(getShowtimeTargetDate(sampleShowtimeDays, "2026-09-17")).toBe(
      "2026-09-17",
    );
    expect(getShowtimeTargetDate(sampleShowtimeDays, "2026-09-30")).toBe(
      "2026-09-16",
    );
    expect(getFirstShowtimeDate(sampleShowtimeDays)).toBe("2026-09-17");
  });

  it("honors reduced motion and safely clones nested showtime data", () => {
    const matchMedia = vi.mocked(window.matchMedia);
    matchMedia.mockReturnValueOnce({ matches: true } as MediaQueryList);
    expect(getScrollBehavior()).toBe("auto");
    matchMedia.mockReturnValueOnce({ matches: false } as MediaQueryList);
    expect(getScrollBehavior()).toBe("smooth");

    const cloned = cloneShowtimeDays(sampleShowtimeDays);
    expect(cloned).toEqual(sampleShowtimeDays);
    expect(cloned).not.toBe(sampleShowtimeDays);
    expect(cloned[1]?.theaters).not.toBe(sampleShowtimeDays[1]?.theaters);
  });

  it("finds the nearest rendered panel by its data date", () => {
    const rail = document.createElement("div");
    const first = document.createElement("section");
    first.dataset.showtimeDate = "2026-09-16";
    const second = document.createElement("section");
    second.dataset.showtimeDate = "2026-09-17";
    Object.defineProperty(first, "offsetLeft", { value: 40 });
    Object.defineProperty(second, "offsetLeft", { value: 160 });
    Object.defineProperty(rail, "scrollLeft", { value: 120, writable: true });
    rail.append(first, second);

    expect(findShowtimePanel(rail, "2026-09-17")).toBe(second);
    expect(getNearestShowtimeDate(rail, sampleShowtimeDays)).toBe("2026-09-17");
    expect(findShowtimePanel(rail, "missing")).toBeNull();
  });
});
