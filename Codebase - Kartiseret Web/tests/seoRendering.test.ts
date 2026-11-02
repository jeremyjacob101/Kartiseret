import { buildSitemapXml, injectSeoPage, safeHttpUrl, xmlEscape } from "../server/seo/renderHtml.js";
import { describe, expect, it } from "vitest";

describe("SEO HTML rendering", () => {
  it("writes one fixed-origin canonical and safely serializes metadata and JSON-LD", () => {
    const html = injectSeoPage(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      {
        title: "A <movie>",
        description: 'A "short" description',
        canonicalPath: "/Ab3",
        body: "<main><h1>A &amp; title</h1></main>",
        jsonLd: { name: "</script><script>alert(1)</script>" },
      },
    );

    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('href="https://seret.site/Ab3"');
    expect(html).toContain("A &lt;movie&gt;");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("<main><h1>A &amp; title</h1></main>");
  });

  it("builds a deduplicated XML sitemap and rejects noncanonical URL variants", () => {
    const xml = buildSitemapXml(["/", "/Ab3", "/Ab3"]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml).toContain("https://seret.site/Ab3");
    expect(() => buildSitemapXml(["/Ab3?date=today"])).toThrow(/canonical/);
    expect(() => xmlEscape("A & B")).not.toContain("A & B");
    expect(xmlEscape("A & B")).toBe("A &amp; B");
  });

  it("allows only HTTP image URLs in metadata", () => {
    const html = injectSeoPage(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      {
        title: "Movie",
        description: "Movie details",
        canonicalPath: "/Ab3",
        imageUrl: "javascript:alert(1)",
        body: "<main><h1>Movie</h1></main>",
      },
    );

    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("https://images.example.test/poster.jpg")).toBe(
      "https://images.example.test/poster.jpg",
    );
    expect(html).toContain(
      'property="og:image" content="https://seret.site/logos/kartiseret1.svg"',
    );
    expect(html).not.toContain("javascript:");
  });
});
