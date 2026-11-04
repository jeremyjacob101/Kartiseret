const SITE_ORIGIN = "https://seret.site";

type SeoMetadata = {
  title: string;
  description: string;
  canonicalPath: string;
  openGraphPath?: string;
  imageUrl?: string;
  robots?: string;
  jsonLd?: unknown;
};

export function safeSeoUrl(value: string | undefined): string | undefined {
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

function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

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
  const image =
    safeSeoUrl(metadata.imageUrl) ?? `${SITE_ORIGIN}/logos/kartiseret1.svg`;
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

  const jsonLdElements = [
    ...document.head.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    ),
  ];
  let jsonLdElement = jsonLdElements.shift();
  jsonLdElements.forEach((element) => element.remove());
  if (metadata.jsonLd === undefined) {
    jsonLdElement?.remove();
  } else {
    if (!jsonLdElement) {
      jsonLdElement = document.createElement("script");
      jsonLdElement.type = "application/ld+json";
      document.head.append(jsonLdElement);
    }
    jsonLdElement.textContent = serializeJsonLd(metadata.jsonLd);
  }
}

export function getCurrentRobotsDirectives(): string {
  return (
    document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
      ?.content ?? "index, follow"
  );
}
