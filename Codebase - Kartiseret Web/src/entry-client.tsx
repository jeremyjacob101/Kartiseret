import { parsePublicPageBootstrap, seedPublicPageQueries } from "./publicRenderBootstrap";
import { preparePublicPagePreferenceState } from "./stores/userPreferencesStore";
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

const canHydrate =
  root.dataset.ssr === "true" &&
  bootstrap?.pathname === window.location.pathname;

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
      await preloadPublicRouteModules(window.location.pathname);
      const publicPreferenceSnapshot = preparePublicPagePreferenceState();
      seedPublicPageQueries(queryClient, bootstrap);
      hydrateRoot(
        root,
        <EntryApplication
          publicPreferenceSnapshot={publicPreferenceSnapshot}
          renderedAt={bootstrap.renderedAt}
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
