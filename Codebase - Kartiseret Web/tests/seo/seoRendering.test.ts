import { buildSitemapXml, injectRenderedApplication, injectSeoPage, safeHttpUrl, xmlEscape } from "../../server/seo/renderHtml.js";
import { describe, expect, it } from "vitest";

describe("SEO HTML rendering", () => {
  it("writes one fixed-origin canonical and safely serializes metadata and JSON-LD", () => {
    const html = injectSeoPage(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body><!-- SEO_CONTENT_START --><!-- SEO_CONTENT_END --></body></html>",
      {
        title: "A <movie>",
        description: 'A "short" description',
        canonicalPath: "/Ab3",
        jsonLd: { name: "</script><script>alert(1)</script>" },
      },
    );

    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('href="https://seret.site/Ab3"');
    expect(html).toContain("A &lt;movie&gt;");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("seo-content");
    expect(html).not.toContain("<noscript>");
  });

  it("injects the actual rendered app into the single root and safely serializes bootstrap data", () => {
    const html = injectRenderedApplication(
      '<html><head></head><body><div id="root"></div></body></html>',
      "<main><h1>Movie</h1></main>",
      { pathname: "/Ab3", title: "</script><script>alert(1)</script>" },
      [
        "https://image.tmdb.org/t/p/w342/poster.jpg?size=1&lang=en",
        "https://image.tmdb.org/t/p/w342/poster.jpg?size=1&lang=en",
        "javascript:alert(1)",
        "https://images.example.test/t/p/w342/poster.jpg",
        "https://image.tmdb.org/t/p/original/poster.jpg",
      ],
    );

    expect(html).toContain(
      '<div id="root" data-ssr="true"><main><h1>Movie</h1></main></div>',
    );
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html.match(/id="root"/g)).toHaveLength(1);
    expect(html).toContain('id="kartiseret-bootstrap" type="application/json"');
    expect(html.match(/rel="preload" as="image"/g)).toHaveLength(1);
    expect(html).toContain(
      'href="https://image.tmdb.org/t/p/w342/poster.jpg?size=1&amp;lang=en" fetchpriority="high"',
    );
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("images.example.test");
  });

  it("preserves replacement tokens in database-derived metadata, markup, and bootstrap values", () => {
    const replacementTokens = "$&|$`|$'";
    const withMetadata = injectSeoPage(
      "<html><head><!-- SEO_META_START --><!-- SEO_META_END --></head><body></body></html>",
      {
        title: replacementTokens,
        description: replacementTokens,
        canonicalPath: "/Ab3",
      },
    );
    const html = injectRenderedApplication(
      `<html><head></head><body><div id="root"></div></body></html>`,
      `<main><h1>${replacementTokens}</h1></main>`,
      { pathname: "/Ab3", title: replacementTokens },
    );

    expect(withMetadata).toContain("<title>$&amp;|$`|$&#039;</title>");
    expect(withMetadata).toContain('content="$&amp;|$`|$&#039;"');
    expect(html).toContain(`<h1>${replacementTokens}</h1>`);
    expect(html).toContain('"title":"$\\u0026|$`|$\'"');
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
