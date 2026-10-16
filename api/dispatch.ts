import { createProductionApp } from "@kartiseret/server/production";
import {
  createVercelDispatchHandler,
  type VercelDispatchHandler,
} from "@kartiseret/server/vercel-dispatch";
import ogHandler from "../Codebase - Kartiseret Web/server/og/handler.js";
import ogImageHandler from "../Codebase - Kartiseret Web/server/og/imageHandler.js";

let productionApi: VercelDispatchHandler | null = null;

function getProductionApi(): VercelDispatchHandler {
  if (!productionApi) {
    productionApi = createProductionApp()
      .app as unknown as VercelDispatchHandler;
  }

  return productionApi;
}

export default createVercelDispatchHandler({
  api: (request, response) => getProductionApi()(request, response),
  og: ogHandler,
  ogImage: ogImageHandler,
});
