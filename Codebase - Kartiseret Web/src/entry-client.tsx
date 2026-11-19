import { initializeUserPreferencesStore, preparePublicPagePreferenceState } from "./stores/userPreferencesStore";
import { privatePageDisplaySchema, type PrivatePageDisplay } from "@kartiseret/contracts/public-render";
import { parsePublicPageBootstrap, seedPublicPageQueries } from "./publicRenderBootstrap";
import { preloadPublicRouteModules } from "./routing/preloadPublicRouteModules";
import { hydrateRoot, createRoot } from "react-dom/client";
import { EntryApplication } from "./entry-application";
import { queryClient } from "./lib/queryClient";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The application root element is missing.");
const root: HTMLElement = rootElement;

const bootstrapElement = document.getElementById("kartiseret-bootstrap");
let bootstrap: ReturnType<typeof parsePublicPageBootstrap> = null;
if (bootstrapElement?.textContent) {
  try {
    bootstrap = parsePublicPageBootstrap(
      JSON.parse(bootstrapElement.textContent),
    );
  } catch {
    bootstrap = null;
  }
}

const initialUrl = new URL(window.location.href);
const bootstrapUrl = bootstrap
  ? new URL(bootstrap.pathname, initialUrl.origin)
  : null;
const requestedDate = initialUrl.searchParams.getAll("date").at(-1);
const canHydrate =
  root.dataset.ssr === "true" &&
  bootstrapUrl?.pathname === initialUrl.pathname &&
  (!requestedDate ||
    !bootstrapUrl.searchParams.has("date") ||
    requestedDate === bootstrapUrl.searchParams.get("date"));

let display: PrivatePageDisplay | undefined;
const displayElement = document.getElementById("kartiseret-display");
if (canHydrate && displayElement?.textContent) {
  try {
    const result = privatePageDisplaySchema.safeParse(
      JSON.parse(displayElement.textContent),
    );
    if (result.success) display = result.data;
  } catch {
    // A malformed snapshot should not prevent the public application loading.
  }
  displayElement.remove();
}
if (initialUrl.pathname !== "/unsubscribe/letterboxd") {
  initializeUserPreferencesStore(display);
}

document.documentElement.classList.remove(
  "no-js",
  "ssr-pending",
  "ssr-poster-entrance",
);
document.documentElement.classList.add("js");

function showReloadControl(): void {
  if (!canHydrate) {
    document.documentElement.classList.remove("js");
    document.documentElement.classList.add("no-js");
  }
  if (root.querySelector('[data-route-load-error="true"]')) return;

  const notice = document.createElement("p");
  notice.className = "app-inline-note";
  notice.setAttribute("role", "alert");
  notice.dataset.routeLoadError = "true";
  notice.append(
    document.createTextNode("This page could not finish loading. "),
  );

  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.className = "app-button";
  reloadButton.textContent = "Reload page";
  reloadButton.addEventListener("click", () => window.location.reload());
  notice.append(reloadButton);
  root.append(notice);
}

async function startClientApplication() {
  if (canHydrate && bootstrap) {
    try {
      const publicRouteComponents = await preloadPublicRouteModules(
        window.location.pathname,
      );
      const publicPreferenceSnapshot =
        preparePublicPagePreferenceState(display);
      seedPublicPageQueries(queryClient, bootstrap);
      hydrateRoot(
        root,
        <EntryApplication
          publicPreferenceSnapshot={publicPreferenceSnapshot}
          renderedAt={bootstrap.renderedAt}
          publicRouteComponents={publicRouteComponents}
        />,
      );
    } catch {
      // Retain the rendered page and give the visitor a deliberate recovery path.
      showReloadControl();
    }
    return;
  }

  createRoot(root).render(<EntryApplication publicPreferenceSnapshot={null} />);
}

void startClientApplication();
