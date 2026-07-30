export type ShareLinkResult = "shared" | "copied" | "cancelled" | "failed";

function copyTextWithLegacyFallback(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export async function shareLink({
  title,
  text,
  url,
}: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareLinkResult> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else if (!copyTextWithLegacyFallback(url)) {
      throw new Error("Copy command was unavailable.");
    }

    return "copied";
  } catch {
    return "failed";
  }
}
