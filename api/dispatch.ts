import {
  dispatcherImportStartedAt,
  timeCatalogStageSync,
  withCatalogTiming,
} from "@kartiseret/server/catalog-timing";
import type { ServerResponse } from "node:http";
import { createProductionApp } from "@kartiseret/server/production";
import {
  getRequestLogger,
  withRequestLogContext,
} from "@kartiseret/server/logging";
import {
  createLazyVercelHandler,
  createVercelDispatchHandler,
  type VercelDispatchHandler,
} from "@kartiseret/server/vercel-dispatch";

const dispatcherImportMs = performance.now() - dispatcherImportStartedAt;
let firstApiRequest = true;

let productionApi: VercelDispatchHandler | null = null;

const ogHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/og/handler.js"),
);
const ogImageHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/og/imageHandler.js"),
);
const seoHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/seo/handler.js"),
);

function getProductionApi(): VercelDispatchHandler {
  if (!productionApi) {
    productionApi = timeCatalogStageSync("runtime_init", () =>
      createProductionApp(),
    ).app as unknown as VercelDispatchHandler;
  }

  return productionApi;
}

export default createVercelDispatchHandler({
  api: (request, response) => {
    const first = firstApiRequest;
    firstApiRequest = false;
    return withRequestLogContext(() =>
      withCatalogTiming(
        request.url,
        response as unknown as ServerResponse,
        { firstApiRequest: first, dispatcherImportMs },
        () => getProductionApi()(request, response),
        (line) => {
          try {
            getRequestLogger().info(JSON.parse(line));
          } catch {
            // Timing diagnostics must not affect an API response.
          }
        },
      ),
    );
  },
  og: (request, response) =>
    withRequestLogContext(() => ogHandler(request, response)),
  ogImage: (request, response) =>
    withRequestLogContext(() => ogImageHandler(request, response)),
  seo: (request, response) =>
    withRequestLogContext(() => seoHandler(request, response)),
});
