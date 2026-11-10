import { getCurrentRobotsDirectives, setSeoMetadata } from "../../src/routing/seoMetadata";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("SEO metadata", () => {
  it("updates a short movie canonical without duplicating canonical tags", () => {
    document.head.innerHTML =
      '<link rel="canonical" href="https://seret.site/">';
    setSeoMetadata({
      title: "Dune showtimes | Kartiseret",
      description: "Movie showtimes",
      canonicalPath: "/Ab3",
      openGraphPath: "/Ab3abc",
    });
    setSeoMetadata({
      title: "Dune showtimes | Kartiseret",
      description: "Movie showtimes",
      canonicalPath: "/Ab3",
      openGraphPath: "/Ab3abc",
    });
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe("https://seret.site/Ab3");
    expect(
      document
        .querySelector('meta[property="og:url"]')
        ?.getAttribute("content"),
    ).toBe("https://seret.site/Ab3abc");
  });

  it("preserves the server robots directive while public data is loading", () => {
    document.head.innerHTML = '<meta name="robots" content="index, follow">';
    expect(getCurrentRobotsDirectives()).toBe("index, follow");
    setSeoMetadata({
      title: "Movies showing in Israel | Kartiseret",
      description: "Browse movies showing at cinemas across Israel.",
      canonicalPath: "/movies",
      robots: getCurrentRobotsDirectives(),
    });
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    ).toBe("index, follow");
  });

  it("marks account routes as non-indexable", () => {
    setSeoMetadata({
      title: "Account",
      description: "Account settings",
      canonicalPath: "/user",
      robots: "noindex, nofollow",
    });
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    ).toBe("noindex, nofollow");
  });

  it("replaces route JSON-LD and removes stale movie data on later routes", () => {
    document.head.innerHTML =
      '<script type="application/ld+json">{"@type":"Movie","name":"Old movie"}</script>';
    setSeoMetadata({
      title: "Movie | Kartiseret",
      description: "Movie details",
      canonicalPath: "/Ab3",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Movie",
        name: "$&|$`|$' </script><script>alert(1)</script>",
      },
    });

    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(1);
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    expect(script?.textContent).toContain("\\u003c/script\\u003e");
    expect(script?.textContent).toContain("$\\u0026|$`|$'");

    setSeoMetadata({
      title: "Movies | Kartiseret",
      description: "Movie listings",
      canonicalPath: "/movies",
    });
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(0);
  });

  it("rejects unsafe client metadata image URLs", () => {
    setSeoMetadata({
      title: "Movie | Kartiseret",
      description: "Movie details",
      canonicalPath: "/Ab3",
      imageUrl: "javascript:alert(1)",
    });
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content"),
    ).toBe("https://seret.site/logos/kartiseret1.svg");
  });
});
