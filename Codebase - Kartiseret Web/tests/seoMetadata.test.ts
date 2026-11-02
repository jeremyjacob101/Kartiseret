import { hasInitialSeoContentForPath, removeInitialSeoContent, setSeoMetadata } from "../src/routing/seoMetadata";
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

  it("marks account routes as non-indexable and removes the no-JavaScript shell when ready", () => {
    document.body.innerHTML = '<div id="seo-content">Initial content</div>';
    setSeoMetadata({
      title: "Account",
      description: "Account settings",
      canonicalPath: "/user",
      robots: "noindex, nofollow",
    });
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    ).toBe("noindex, nofollow");
    removeInitialSeoContent();
    expect(document.getElementById("seo-content")).toBeNull();
  });

  it("recognizes initial SSR content only for its current short path", () => {
    document.body.innerHTML =
      '<div id="seo-content" data-seo-route="/Ab3abc">Movie</div>';
    expect(hasInitialSeoContentForPath("/Ab3abc")).toBe(true);
    expect(hasInitialSeoContentForPath("/Ab3")).toBe(false);
  });
});
