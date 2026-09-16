export function formatPreviewReleaseDate(releaseDate: string | null): string {
  if (!releaseDate) {
    return "TBA";
  }

  const parsedDate = new Date(`${releaseDate}T12:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return releaseDate;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsedDate);
}
