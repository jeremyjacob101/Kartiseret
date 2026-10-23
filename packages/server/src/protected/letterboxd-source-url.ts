import { HttpError } from "../http-errors.js";

export function parseLetterboxdSourceUrl(value: string): {
  sourceUrl: string;
  sourceType: "watchlist" | "list";
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(
      400,
      "invalid_letterboxd_source",
      "Enter a public Letterboxd watchlist or list URL.",
    );
  }
  if (
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === "boxd.it" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash
  ) {
    const shortLink = url.pathname.match(
      /^\/([A-Za-z0-9]+(?:\$[A-Za-z0-9_-]{1,180})?)\/?$/,
    );
    if (shortLink)
      return {
        sourceUrl: `https://boxd.it/${shortLink[1]}/`,
        sourceType: "list",
      };
  }
  if (
    url.protocol !== "https:" ||
    !["letterboxd.com", "www.letterboxd.com"].includes(
      url.hostname.toLowerCase(),
    ) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new HttpError(
      400,
      "invalid_letterboxd_source",
      "Enter a public Letterboxd watchlist or list URL.",
    );

  let parts: string[];
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new HttpError(
      400,
      "invalid_letterboxd_source",
      "Enter a public Letterboxd watchlist or list URL.",
    );
  }
  const validSegment = (part: string) => /^[A-Za-z0-9_-]{1,100}$/.test(part);
  const username = parts[0] ?? "";
  const isWatchlist =
    parts.length === 2 && parts[1]?.toLowerCase() === "watchlist";
  const isList = parts.length === 3 && parts[1]?.toLowerCase() === "list";
  const isSharedList =
    parts.length === 5 &&
    parts[1]?.toLowerCase() === "list" &&
    parts[3]?.toLowerCase() === "share";
  if (
    !validSegment(username) ||
    (!isWatchlist && !isList && !isSharedList) ||
    ((isList || isSharedList) && !validSegment(parts[2] ?? "")) ||
    (isSharedList && !validSegment(parts[4] ?? ""))
  )
    throw new HttpError(
      400,
      "invalid_letterboxd_source",
      "Use a public watchlist or list URL, or a list share link visible to anyone with the link.",
    );

  const canonicalParts = [...parts];
  if (isWatchlist) canonicalParts[1] = "watchlist";
  if (isList || isSharedList) canonicalParts[1] = "list";
  if (isSharedList) canonicalParts[3] = "share";
  const path = canonicalParts.map(encodeURIComponent).join("/");
  return {
    sourceUrl: `https://letterboxd.com/${path}/`,
    sourceType: isWatchlist ? "watchlist" : "list",
  };
}
