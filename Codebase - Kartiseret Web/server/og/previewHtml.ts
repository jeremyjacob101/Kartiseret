import { socialPreviewImageUrl } from "@kartiseret/contracts/social-preview";
import { injectSeoPage, safeHttpUrl } from "../seo/renderHtml.js";
import type { PreviewData } from "./previewData.js";

export function buildPreviewDescription(data: PreviewData): string {
  if (data.isComingSoon) {
    return "Coming soon on Kartiseret";
  }

  const theaterText = data.theaters
    .slice(0, 2)
    .map((theater) => `${theater.theater}: ${theater.showtimes.join(", ")}`)
    .join(" · ");

  return theaterText
    ? `${data.city} · ${data.dateLabel} · ${theaterText}`
    : `${data.city} · ${data.dateLabel} · View available showtimes`;
}

export function injectOpenGraphTags(
  html: string,
  data: PreviewData,
  siteOrigin: string,
): string {
  const pageTitle = data.isComingSoon
    ? `${data.title} — Coming soon`
    : `${data.title} showtimes in ${data.city}`;
  const description = buildPreviewDescription(data);
  const imageUrl =
    (data.socialPreviewFingerprint
      ? socialPreviewImageUrl(siteOrigin, data.socialPreviewFingerprint)
      : null) ??
    safeHttpUrl(data.posterUrl) ??
    `${siteOrigin}/logos/kartiseret1.svg`;
  return injectSeoPage(html, {
    title: `${pageTitle} | Kartiseret`,
    description,
    canonicalPath: `/${data.movieCode}`,
    openGraphPath: `/${data.routeCode}`,
    imageUrl: safeHttpUrl(imageUrl),
    imageAlt: pageTitle,
  });
}
