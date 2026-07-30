import type { PreviewData } from "./previewData.js";

const PREVIEW_CRAWLER_FAVICON =
  '<link rel="icon" href="/logos/kartiseret1_white.ico?v=2" />';

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

export function injectPreviewCrawlerFavicon(html: string): string {
  return html.replace(
    "<!-- OG_START -->",
    `${PREVIEW_CRAWLER_FAVICON}\n  <!-- OG_START -->`,
  );
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
  const pageUrl = `${siteOrigin}/${data.routeCode}`;
  const imageUrl = `${siteOrigin}/api/og-image?routeCode=${encodeURIComponent(data.routeCode)}`;

  const openGraphBlock = `<!-- OG_START -->
<title>${escapeHtml(pageTitle)} | Kartiseret</title>
<meta name="description" content="${escapeHtml(description)}" />

<meta property="og:title" content="${escapeHtml(pageTitle)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(pageTitle)}" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Kartiseret" />

<meta name="twitter:card" content="summary_large_image" />
<!-- OG_END -->`;

  return html.replace(
    /<!-- OG_START -->[\s\S]*?<!-- OG_END -->/,
    openGraphBlock,
  );
}
