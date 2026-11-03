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

async function startClientApplication() {
  if (canHydrate && bootstrap) {
    try {
      await preloadPublicRouteModules(window.location.pathname);
    } catch {
      // Keep the server-rendered public content visible if a route chunk fails.
      return;
    }

    const publicPreferenceSnapshot = preparePublicPagePreferenceState();
    seedPublicPageQueries(queryClient, bootstrap);
    hydrateRoot(
      root,
      <EntryApplication publicPreferenceSnapshot={publicPreferenceSnapshot} />,
    );
    return;
  }

  createRoot(root).render(<EntryApplication publicPreferenceSnapshot={null} />);
}

void startClientApplication();
