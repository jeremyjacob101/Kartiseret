import type { PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

type PublicRendererModule = {
  renderPublicApplication: (
    bootstrap: PublicPageBootstrap,
    timeoutMs?: number,
  ) => Promise<string>;
};

let publicRendererPromise: Promise<PublicRendererModule> | null = null;

export function renderBuiltPublicApplication(
  bootstrap: PublicPageBootstrap,
): Promise<string> {
  if (!publicRendererPromise) {
    const entryPath = resolve(
      process.cwd(),
      "Codebase - Kartiseret Web/dist-ssr/entry-server.js",
    );
    publicRendererPromise = import(pathToFileURL(entryPath).href)
      .then((module) => module as PublicRendererModule)
      .catch((error: unknown) => {
        publicRendererPromise = null;
        throw error;
      });
  }
  return publicRendererPromise.then((renderer) =>
    renderer.renderPublicApplication(bootstrap));
}
