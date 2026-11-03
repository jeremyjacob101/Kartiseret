const SITE_ORIGIN = "https://seret.site";

type SeoMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  openGraphPath?: string;
  imageUrl?: string;
  robots?: string;
};

function setMeta(
  selector: string,
  attribute: "name" | "property",
  key: string,
  value: string,
): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = value;
}

export function setSeoMetadata(metadata: SeoMetadata): void {
  const canonical = new URL(metadata.canonicalPath, SITE_ORIGIN).toString();
  const image = metadata.imageUrl ?? `${SITE_ORIGIN}/logos/kartiseret1.svg`;
  document.title = metadata.title;
  setMeta(
    'meta[name="description"]',
    "name",
    "description",
    metadata.description,
  );
  setMeta(
    'meta[name="robots"]',
    "name",
    "robots",
    metadata.robots ?? "index, follow",
  );
  setMeta('meta[property="og:title"]', "property", "og:title", metadata.title);
  setMeta(
    'meta[property="og:description"]',
    "property",
    "og:description",
    metadata.description,
  );
  setMeta('meta[property="og:image"]', "property", "og:image", image);
  setMeta(
    'meta[property="og:image:secure_url"]',
    "property",
    "og:image:secure_url",
    image,
  );
  setMeta(
    'meta[property="og:image:alt"]',
    "property",
    "og:image:alt",
    metadata.title,
  );
  setMeta(
    'meta[property="og:url"]',
    "property",
    "og:url",
    new URL(
      metadata.openGraphPath ?? metadata.canonicalPath,
      SITE_ORIGIN,
    ).toString(),
  );
  setMeta(
    'meta[name="twitter:card"]',
    "name",
    "twitter:card",
    "summary_large_image",
  );
  setMeta(
    'meta[name="twitter:title"]',
    "name",
    "twitter:title",
    metadata.title,
  );
  setMeta(
    'meta[name="twitter:description"]',
    "name",
    "twitter:description",
    metadata.description,
  );
  setMeta('meta[name="twitter:image"]', "name", "twitter:image", image);
  let canonicalElement = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonicalElement) {
    canonicalElement = document.createElement("link");
    canonicalElement.rel = "canonical";
    document.head.append(canonicalElement);
  }
  canonicalElement.href = canonical;
}

export function removeInitialSeoContent(): void {
  document.getElementById("seo-content")?.remove();
}

export function hasInitialSeoContentForPath(pathname: string): boolean {
  return (
    document.getElementById("seo-content")?.getAttribute("data-seo-route") ===
    pathname
  );
}

export function getCurrentRobotsDirectives(): string {
  return (
    document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
      ?.content ?? "index, follow"
  );
}
