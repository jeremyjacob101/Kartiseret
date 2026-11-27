import { setSeoMetadata } from "../../src/routing/seoMetadata";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  document.head.innerHTML = "";
});

describe("client SEO metadata", () => {
  it("keeps canonical, social, and structured page URLs on the opaque code", () => {
    window.history.replaceState({}, "", "/abcd1234");
    setSeoMetadata({
      title: "Movie | Kartiseret",
      description: "Movie showtimes.",
      canonicalPath: "/D01",
      openGraphPath: "/D01?date=2026-11-26",
      jsonLd: {
        "@type": "Movie",
        url: "https://seret.site/D01",
        relatedLink: { url: "/showtimes/jerusalem" },
        source: { url: "https://example.com/movie" },
      },
    });

    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://seret.site/abcd1234",
    );
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute(
      "content",
      "https://seret.site/abcd1234",
    );
    expect(
      JSON.parse(
        document.querySelector('script[type="application/ld+json"]')
          ?.textContent ?? "null",
      ),
    ).toEqual({
      "@type": "Movie",
      url: "https://seret.site/abcd1234",
      relatedLink: { url: "https://seret.site/abcd1234" },
      source: { url: "https://example.com/movie" },
    });
  });

  it("preserves the logical canonical on non-code pages before redirect", () => {
    window.history.replaceState({}, "", "/privacy");
    setSeoMetadata({
      title: "Privacy | Kartiseret",
      description: "Privacy information.",
      canonicalPath: "/privacy",
    });

    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://seret.site/privacy",
    );
  });
});
