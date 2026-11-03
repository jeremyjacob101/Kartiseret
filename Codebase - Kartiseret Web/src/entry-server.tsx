import { preparePublicPagePreferenceState, PublicPreferencesSnapshotProvider } from "./stores/userPreferencesStore.js";
import { MovieDisplayPreferencesProvider } from "./contexts/MovieDisplayPreferencesProvider.js";
import { preloadPublicRouteModules } from "./routing/preloadPublicRouteModules.js";
import type { PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { PublicRenderClockProvider } from "./contexts/PublicRenderClock.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { seedPublicPageQueries } from "./publicRenderBootstrap.js";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router";
import { PassThrough } from "node:stream";
import { App } from "./App.js";

function withTimeout<Value>(
  operation: Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Public page rendering exceeded its deadline.")),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createRequestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createApplication(
  pathname: string,
  renderedAt: string,
  queryClient: QueryClient,
  preferenceSnapshot: ReturnType<typeof preparePublicPagePreferenceState>,
) {
  return (
    <PublicRenderClockProvider initialInstant={renderedAt}>
      <PublicPreferencesSnapshotProvider snapshot={preferenceSnapshot}>
        <QueryClientProvider client={queryClient}>
          <StaticRouter location={pathname}>
            <MovieDisplayPreferencesProvider>
              <App />
            </MovieDisplayPreferencesProvider>
          </StaticRouter>
        </QueryClientProvider>
      </PublicPreferencesSnapshotProvider>
    </PublicRenderClockProvider>
  );
}

export async function renderPublicApplication(
  bootstrap: PublicPageBootstrap,
  timeoutMs = 12_000,
): Promise<string> {
  const startedAt = Date.now();
  await withTimeout(preloadPublicRouteModules(bootstrap.pathname), timeoutMs);
  const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
  if (remainingTimeoutMs <= 0) {
    throw new Error("Public page rendering exceeded its deadline.");
  }
  const preferenceSnapshot = preparePublicPagePreferenceState();

  const queryClient = createRequestQueryClient();
  seedPublicPageQueries(queryClient, bootstrap);
  const application = createApplication(
    bootstrap.pathname,
    bootstrap.renderedAt,
    queryClient,
    preferenceSnapshot,
  );

  return new Promise((resolve, reject) => {
    let completed = false;
    const rendererHandle: {
      current: ReturnType<typeof renderToPipeableStream> | null;
    } = { current: null };
    let renderError: unknown;
    const stream = new PassThrough();
    const fail = (error: unknown) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      queryClient.clear();
      reject(error);
    };
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      queryClient.clear();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    const timer = setTimeout(() => {
      rendererHandle.current?.abort();
      fail(new Error("Public page rendering exceeded its deadline."));
    }, remainingTimeoutMs);

    rendererHandle.current = renderToPipeableStream(application, {
      onAllReady() {
        if (renderError !== undefined) {
          fail(renderError);
          return;
        }
        if (!completed) rendererHandle.current?.pipe(stream);
      },
      onShellError: fail,
      onError(error) {
        renderError = error;
      },
    });
  });
}
