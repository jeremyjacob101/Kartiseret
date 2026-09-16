import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getPreviewData, resolvePreviewRouteSelection, type PreviewData } from "../server/og/previewData";
import { buildPreviewDescription, injectOpenGraphTags } from "../server/og/previewHtml";
import { formatPreviewReleaseDate } from "../server/og/previewFormat";
import { encodeDateCode, encodeMovieRouteCode } from "../src/routing/showtimeLinkCodec";

function createPreviewClient(options: {
  movie?: Record<string, unknown> | null;
  comingSoon?: Record<string, unknown> | null;
  showtimes?: Record<string, unknown>[];
  codeRows?: Record<string, unknown>[];
}) {
  return createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const table = new URL(request.url).pathname.split("/").at(-1);
        if (table === "movieCodes") {
          return new Response(
            JSON.stringify(options.codeRows ?? [{ tmdb_id: 101 }]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (table === "finalMovies") {
          return new Response(
            JSON.stringify(options.movie ? [options.movie] : []),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (table === "finalSoons") {
          return new Response(
            JSON.stringify(options.comingSoon ? [options.comingSoon] : []),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (table === "finalShowtimes") {
          return new Response(JSON.stringify(options.showtimes ?? []), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: "Unknown table" }), {
          status: 500,
        });
      },
    },
  });
}

const movie = {
  english_title: "Preview Movie",
  en_poster: " /poster.jpg ",
  backdrop: " /backdrop.jpg ",
  release_year: 2026,
  runtime: 125,
  genres: '["Drama", "Comedy"]',
  imdbRating: 8.3,
  rtCriticRating: 80,
  rtCriticVotes: 100,
  rtAudienceRating: 92,
  rtAudienceVotes: 600,
  lbRating: 4.2,
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

  it("hydrates now-playing preview data, filters expired rows, and groups showtimes", async () => {
    const instant = new Date("2026-09-16T16:00:00Z");
    const data = await getPreviewData(
      "Ab1",
      instant,
      createPreviewClient({
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

  it("returns coming-soon metadata without exposing showtime rows", async () => {
    const data = await getPreviewData(
      "Ab1",
      new Date("2026-09-16T16:00:00Z"),
      createPreviewClient({
        movie: null,
        comingSoon: {
          ...movie,
          release_date: "2026-10-12",
        },
      }),
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
