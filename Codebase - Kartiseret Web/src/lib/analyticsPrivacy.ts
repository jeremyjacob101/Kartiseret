import { isSecureEmailActionPath } from "@kartiseret/contracts/public-routes";
import type { BeforeSendEvent } from "@vercel/analytics";
import { PASSWORD_RESET_PATH } from "./authRoutes";

const sensitivePaths = new Set([
  PASSWORD_RESET_PATH,
  "/confirm-account-deletion",
  "/unsubscribe/letterboxd",
]);

export function filterAnalyticsEvent(
  event: BeforeSendEvent,
): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    const pathname = decodeURIComponent(url.pathname)
      .replace(/\/+$/, "")
      .toLowerCase();
    if (sensitivePaths.has(pathname) || isSecureEmailActionPath(pathname)) {
      return null;
    }

    url.search = "";
    url.hash = "";
    return { ...event, url: url.href };
  } catch {
    return null;
  }
}
