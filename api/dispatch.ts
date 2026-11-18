import {
  dispatcherImportStartedAt,
  timeCatalogStageSync,
  withCatalogTiming,
  withPublicPageTiming,
} from "@kartiseret/server/catalog-timing";
import type { ServerResponse } from "node:http";
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

const ogHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/og/handler.js"),
);
const ogImageHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/og/imageHandler.js"),
);
const seoHandler = createLazyVercelHandler(
  () => import("../Codebase - Kartiseret Web/server/seo/handler.js"),
);

const productionApi = createLazyVercelHandler(async () => {
  const { createProductionApp } = await import("@kartiseret/server/production");
  const { app } = timeCatalogStageSync("runtime_init", createProductionApp);
  return { default: app as unknown as VercelDispatchHandler };
});

export default createVercelDispatchHandler({
  api: (request, response) => {
    const first = firstApiRequest;
    firstApiRequest = false;
    return withRequestLogContext(() =>
      withCatalogTiming(
        request.url,
        response as unknown as ServerResponse,
        { firstApiRequest: first, dispatcherImportMs },
        () => productionApi(request, response),
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
    withRequestLogContext(() =>
      withPublicPageTiming(
        request.url?.split("?", 1)[0]?.replace(/^\/api\//, "") ?? "unknown",
        response as unknown as ServerResponse,
        () => seoHandler(request, response),
      ),
    ),
});
