import { injectOpenGraphTags } from "../../server/og/previewHtml.js";
import type { PreviewData } from "../../server/og/previewData.js";
import { describe, expect, it } from "vitest";

const preview: PreviewData = {
  routeCode: "Ab3abc",
  movieCode: "Ab3",
  tmdbId: "123",
  title: "A <Movie>",
  city: "Jerusalem",
  date: "2026-11-02",
  dateLabel: "Monday, Nov 2",
  posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
  backdropUrl: "",
  isComingSoon: false,
  theaters: [{ theater: "Cinema & More", showtimes: ["18:30"] }],
  year: 2026,
  releaseDate: null,
  runtime: 120,
  genres: ["Drama"],
  imdbRating: null,
  rtCriticRating: null,
  rtCriticVotes: null,
  rtAudienceRating: null,
  rtAudienceVotes: null,
  lbRating: null,
};

describe("movie share preview HTML", () => {
  it("keeps the address short and uses the permanent movie code as canonical", () => {
    const html = injectOpenGraphTags(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      preview,
      "https://seret.site",
    );
    expect(html).toContain('href="https://seret.site/Ab3"');
    expect(html).toContain(
      'property="og:url" content="https://seret.site/Ab3abc"',
    );
    expect(html).not.toContain(
      'rel="canonical" href="https://seret.site/Ab3abc"',
    );
    expect(html).toContain("A &lt;Movie&gt;");
    expect(html).not.toContain("<li>Cinema &amp; More");
    expect(html).not.toContain("<main>");
  });

  it("points both short and signed movie links at the immutable stored card", () => {
    const fingerprint = "f".repeat(64);
    const html = injectOpenGraphTags(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      { ...preview, socialPreviewFingerprint: fingerprint },
      "https://dev.example.test",
    );

    expect(html).toContain(
      `property="og:image" content="https://dev.example.test/api/images/social/v1/${fingerprint}/card.jpg"`,
    );
    expect(html).toContain(
      `name="twitter:image" content="https://dev.example.test/api/images/social/v1/${fingerprint}/card.jpg"`,
    );
    expect(html).not.toContain("/api/og-image?");
  });

  it("uses the poster during backfill when a card fingerprint is not published yet", () => {
    const html = injectOpenGraphTags(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      preview,
      "https://seret.site",
    );

    expect(html).toContain(
      'property="og:image" content="https://image.tmdb.org/t/p/w500/poster.jpg"',
    );
    expect(html).not.toContain("/api/og-image?");
  });
});
