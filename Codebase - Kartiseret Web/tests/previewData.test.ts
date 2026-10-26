import { encodeDateCode, encodeMovieRouteCode, filterMaskFromUnchecked } from "@kartiseret/contracts/showtime-links";
import { getPreviewData, resolvePreviewRouteSelection, type PreviewData } from "../server/og/previewData";
import { buildPreviewDescription, injectOpenGraphTags } from "../server/og/previewHtml";
import type { PublicDataRepository } from "@kartiseret/server/public-data";
import { formatPreviewReleaseDate } from "../server/og/previewFormat";
import { describe, expect, it } from "vitest";

function createPreviewRepository(options: {
  movie?: Record<string, unknown> | null;
  comingSoon?: Record<string, unknown> | null;
  showtimes?: Record<string, unknown>[];
  codeRows?: Record<string, unknown>[];
}): PublicDataRepository {
  const tmdbId = String(options.codeRows?.[0]?.tmdb_id ?? 101);
  const showtimeRows = (options.showtimes ?? []).map((row) => ({
    tmdbId: Number(tmdbId),
    screeningCity: "Jerusalem",
    dateOfShowing: "2026-09-16",
    cinema: row.cinema,
    showtime: row.showtime,
    englishHref: null,
    hebrewHref: null,
    screeningTech: row.screening_tech,
    screeningType: row.screening_type,
    dubLanguage: row.dub_language,
  }));

  return {
    findNowPlayingRows: async () => [],
    findMovieCodes: async () => new Map(),
    findComingSoonRows: async () => [],
    findCinemathequeRows: async () => [],
    findShowtimeRows: async () => showtimeRows,
    findTicketAvailabilityRows: async () => [],
    findTheaterCityRows: async () => [],
    findMovieCodeByCode: async () =>
      options.codeRows?.length === 0 ? null : tmdbId,
    findNowPlayingMovieById: async () => options.movie ?? null,
    findComingSoonMovieById: async () => options.comingSoon ?? null,
  };
}

const movie = {
  tmdbId: 101,
  englishTitle: "Preview Movie",
  enPoster: " /poster.jpg ",
  backdrop: " /backdrop.jpg ",
  releaseYear: 2026,
  genres: ["Drama", "Comedy"],
  enTrailer: null,
  imdbId: null,
  rtId: null,
  imdbRating: 8.3,
  imdbVotes: null,
  rtAudienceRating: 92,
  rtAudienceVotes: 600,
  rtCriticRating: 80,
  rtCriticVotes: 100,
  lbId: null,
  lbRating: 4.2,
  lbVotes: 120,
  tmdbRating: null,
  tmdbVotes: null,
  runtime: 125,
  popularity: 10,
  altOptions: [],
  soloUpdate: false,
};

const comingSoon = {
  tmdbId: 101,
  englishTitle: "Preview Movie",
  hebrewTitle: "סרט לדוגמה",
  releaseDate: "2026-10-12",
  releaseYear: 2026,
  enPoster: "/poster.jpg",
  backdrop: "/backdrop.jpg",
  enTrailer: null,
  genres: ["Drama", "Comedy"],
  runtime: 125,
  popularity: 10,
  altOptions: [],
  soloUpdate: false,
};

describe("social preview route and data handling", () => {
  it("resolves plain and encoded route selections against the cinema day", () => {
    const instant = new Date("2026-09-16T16:00:00Z");
    expect(resolvePreviewRouteSelection("Ab1", instant)).toEqual({
      movieCode: "Ab1",
      city: "Jerusalem",
      date: "2026-09-16",
      filterMask: 0,
    });

    const dateCode = encodeDateCode("2026-09-17");
    const routeCode = encodeMovieRouteCode({
      movieCode: "Ab1",
      cityCode: "i",
      dateCode: dateCode!,
      filterMask: 0,
      mode: "share",
    });
    expect(resolvePreviewRouteSelection(routeCode!, instant)).toEqual({
      movieCode: "Ab1",
      city: "Jerusalem",
      date: "2026-09-17",
      filterMask: 0,
    });
    expect(resolvePreviewRouteSelection("broken", instant)).toBeNull();
  });

  it("loads normalized Drizzle-backed preview data, filters expired rows, and groups showtimes", async () => {
    const instant = new Date("2026-09-16T16:00:00Z");
    const data = await getPreviewData(
      "Ab1",
      instant,
      createPreviewRepository({
        movie,
        showtimes: [
          {
            cinema: "Cinema City",
            showtime: "20:00",
            screening_tech: "2D",
            screening_type: "Regular",
            dub_language: null,
          },
          {
            cinema: "Cinema City",
            showtime: "18:00",
            screening_tech: "2D",
            screening_type: "Regular",
            dub_language: null,
          },
          {
            cinema: "Yes Planet",
            showtime: "21:00",
            screening_tech: "3D IMAX",
            screening_type: "VIP",
            dub_language: "Hebrew",
          },
          {
            cinema: "",
            showtime: "22:00",
            screening_tech: "2D",
            screening_type: "Regular",
            dub_language: null,
          },
        ],
      }),
    );

    expect(data).toMatchObject({
      routeCode: "Ab1",
      movieCode: "Ab1",
      tmdbId: "101",
      title: "Preview Movie",
      city: "Jerusalem",
      isComingSoon: false,
      genres: ["Drama", "Comedy"],
      imdbRating: 8.3,
    });
    expect(data?.theaters).toEqual([
      { theater: "Cinema City", showtimes: ["20:00"] },
      { theater: "Yes Planet", showtimes: ["21:00"] },
    ]);
  });

  it("applies encoded filters to valid future showtimes", async () => {
    const instant = new Date("2026-09-16T16:00:00Z");
    const dateCode = encodeDateCode("2026-09-16");
    const filterMask = filterMaskFromUnchecked({
      showType: [],
      screeningTech: [],
      screenFormat: ["3D"],
      dubLanguage: [],
    });
    const routeCode = encodeMovieRouteCode({
      movieCode: "Ab1",
      cityCode: "i",
      dateCode: dateCode!,
      filterMask,
      mode: "share",
    });
    const data = await getPreviewData(
      routeCode!,
      instant,
      createPreviewRepository({
        movie,
        showtimes: [
          {
            cinema: "Cinema City",
            showtime: "20:00",
            screening_tech: "2D",
            screening_type: "Regular",
            dub_language: null,
          },
          {
            cinema: "Cinema City",
            showtime: "21:00",
            screening_tech: "3D IMAX",
            screening_type: "VIP",
            dub_language: "Hebrew",
          },
          {
            cinema: "Yes Planet",
            showtime: "18:00",
            screening_tech: "2D",
            screening_type: "Regular",
            dub_language: null,
          },
        ],
      }),
    );

    expect(data?.theaters).toEqual([
      { theater: "Cinema City", showtimes: ["20:00"] },
    ]);
  });

  it("returns no preview for invalid links or unknown permanent codes", async () => {
    const instant = new Date("2026-09-16T16:00:00Z");
    expect(
      await getPreviewData(
        "broken",
        instant,
        createPreviewRepository({ movie }),
      ),
    ).toBeNull();
    expect(
      await getPreviewData(
        "Ab1",
        instant,
        createPreviewRepository({ movie: null, codeRows: [] }),
      ),
    ).toBeNull();
  });

  it("returns coming-soon metadata without exposing showtime rows", async () => {
    const data = await getPreviewData(
      "Ab1",
      new Date("2026-09-16T16:00:00Z"),
      createPreviewRepository({ movie: null, comingSoon }),
    );

    expect(data).toMatchObject({
      title: "Preview Movie",
      isComingSoon: true,
      releaseDate: "2026-10-12",
      theaters: [],
    });
  });

  it("builds escaped Open Graph metadata and stable descriptions", () => {
    const data: PreviewData = {
      routeCode: "Ab1",
      movieCode: "Ab1",
      tmdbId: "101",
      title: "A <Movie> & Friends",
      city: "Jerusalem",
      date: "2026-09-16",
      dateLabel: "Wednesday, Sep 16",
      posterUrl: "",
      backdropUrl: "",
      isComingSoon: false,
      theaters: [{ theater: "Cinema City", showtimes: ["20:00", "22:00"] }],
      year: 2026,
      releaseDate: null,
      runtime: 120,
      genres: ["Drama"],
      imdbRating: 8,
      rtCriticRating: null,
      rtCriticVotes: null,
      rtAudienceRating: null,
      rtAudienceVotes: null,
      lbRating: null,
    };

    expect(buildPreviewDescription(data)).toContain(
      "Cinema City: 20:00, 22:00",
    );
    const html = injectOpenGraphTags(
      "<html><head><!-- OG_START -->old<!-- OG_END --></head></html>",
      data,
      "https://example.test",
    );
    expect(html).toContain(
      "A &lt;Movie&gt; &amp; Friends showtimes in Jerusalem",
    );
    expect(html).toContain("og:image");
    expect(html).not.toContain(">old<");
  });

  it.each([
    [null, "TBA"],
    ["2026-10-12", "October 12, 2026"],
    ["not-a-date", "not-a-date"],
  ] as const)("formats preview release dates safely", (value, expected) => {
    expect(formatPreviewReleaseDate(value)).toBe(expected);
  });
});
