import {
  dispatcherImportStartedAt,
  timeCatalogStageSync,
  withCatalogTiming,
} from "@kartiseret/server/catalog-timing";
import type { ServerResponse } from "node:http";
import { createProductionApp } from "@kartiseret/server/production";
import {
  createVercelDispatchHandler,
  type VercelDispatchHandler,
} from "@kartiseret/server/vercel-dispatch";
import ogHandler from "../Codebase - Kartiseret Web/server/og/handler.js";
import ogImageHandler from "../Codebase - Kartiseret Web/server/og/imageHandler.js";

const dispatcherImportMs = performance.now() - dispatcherImportStartedAt;
let firstApiRequest = true;

let productionApi: VercelDispatchHandler | null = null;

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
    return withCatalogTiming(
      request.url,
      response as unknown as ServerResponse,
      { firstApiRequest: first, dispatcherImportMs },
      () => getProductionApi()(request, response),
    );
  },
  og: ogHandler,
  ogImage: ogImageHandler,
});
