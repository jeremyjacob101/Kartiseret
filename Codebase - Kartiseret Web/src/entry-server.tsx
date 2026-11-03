import { preparePublicPagePreferenceState, PublicPreferencesSnapshotProvider } from "./stores/userPreferencesStore.js";
import { MovieDisplayPreferencesProvider } from "./contexts/MovieDisplayPreferencesProvider.js";
import { preloadPublicRouteModules } from "./routing/preloadPublicRouteModules.js";
import type { PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { seedPublicPageQueries } from "./publicRenderBootstrap.js";
import { setAppRenderInstant } from "./data/movieCatalog.js";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router";
import { PassThrough } from "node:stream";
import { App } from "./App.js";

let renderQueue = Promise.resolve();

async function withRequestRenderLock<Value>(
  render: (remainingTimeoutMs: number) => Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  const queuedAt = Date.now();
  const previous = renderQueue;
  let release: (() => void) | undefined;
  renderQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  let queueTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        queueTimer = setTimeout(
          () =>
            reject(new Error("Public page rendering exceeded its deadline.")),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    void previous.then(() => release?.());
    throw error;
  } finally {
    if (queueTimer) clearTimeout(queueTimer);
  }

  const remainingTimeoutMs = timeoutMs - (Date.now() - queuedAt);
  if (remainingTimeoutMs <= 0) {
    release?.();
    throw new Error("Public page rendering exceeded its deadline.");
  }

  try {
    return await render(remainingTimeoutMs);
  } finally {
    release?.();
  }
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
  queryClient: QueryClient,
  preferenceSnapshot: ReturnType<typeof preparePublicPagePreferenceState>,
) {
  return (
    <PublicPreferencesSnapshotProvider snapshot={preferenceSnapshot}>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={pathname}>
          <MovieDisplayPreferencesProvider>
            <App />
          </MovieDisplayPreferencesProvider>
        </StaticRouter>
      </QueryClientProvider>
    </PublicPreferencesSnapshotProvider>
  );
}

export async function renderPublicApplication(
  bootstrap: PublicPageBootstrap,
  timeoutMs = 12_000,
): Promise<string> {
  await preloadPublicRouteModules(bootstrap.pathname);

  return withRequestRenderLock(async (remainingTimeoutMs) => {
    const instant = new Date(bootstrap.renderedAt);
    setAppRenderInstant(instant);
    const preferenceSnapshot = preparePublicPagePreferenceState();

    const queryClient = createRequestQueryClient();
    seedPublicPageQueries(queryClient, bootstrap);
    const application = createApplication(
      bootstrap.pathname,
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
  }, timeoutMs);
}
