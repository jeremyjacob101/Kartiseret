export const SITE_ORIGIN = "https://seret.site";

export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value, SITE_ORIGIN);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export type SeoPage = {
  title: string;
  description: string;
  canonicalPath: string;
  openGraphPath?: string;
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  jsonLd?: unknown;
  noindex?: boolean;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function injectSeoPage(html: string, page: SeoPage): string {
  const canonical = new URL(page.canonicalPath, SITE_ORIGIN).toString();
  const openGraphUrl = new URL(
    page.openGraphPath ?? page.canonicalPath,
    SITE_ORIGIN,
  ).toString();
  const imageUrl =
    safeHttpUrl(page.imageUrl) ?? `${SITE_ORIGIN}/logos/kartiseret1.svg`;
  const jsonLd =
    page.jsonLd === undefined
      ? ""
      : `<script type="application/ld+json">${escapeJsonLd(page.jsonLd)}</script>`;
  const metadata = `<!-- SEO_META_START -->
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
<meta name="robots" content="${page.noindex ? "noindex, nofollow" : "index, follow"}" />
<meta property="og:title" content="${escapeHtml(page.title)}" />
<meta property="og:description" content="${escapeHtml(page.description)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:alt" content="${escapeHtml(page.imageAlt ?? page.title)}" />
<meta property="og:url" content="${escapeHtml(openGraphUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Kartiseret" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(page.title)}" />
<meta name="twitter:description" content="${escapeHtml(page.description)}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
${jsonLd}
<!-- SEO_META_END -->`;
  const seoRoute = page.openGraphPath ?? page.canonicalPath;
  const content = `<!-- SEO_CONTENT_START -->\n<noscript><div id="seo-content" class="seo-content" data-seo-route="${escapeHtml(seoRoute)}">${page.body}</div></noscript>\n<!-- SEO_CONTENT_END -->`;
  return html
    .replace(/<!-- SEO_META_START -->[\s\S]*?<!-- SEO_META_END -->/, metadata)
    .replace(
      /<!-- SEO_CONTENT_START -->[\s\S]*?<!-- SEO_CONTENT_END -->/,
      content,
    );
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSitemapXml(paths: readonly string[]): string {
  const entries = [...new Set(paths)].map((path) => {
    const url = new URL(path, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN || url.search || url.hash) {
      throw new Error("Sitemap paths must be canonical same-site paths.");
    }
    return `  <url><loc>${xmlEscape(url.toString())}</loc></url>`;
  });
  if (entries.length > 50_000) {
    throw new Error("Sitemap exceeds the URL count limit.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}
