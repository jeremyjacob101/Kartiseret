import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

// Imported first by the dispatcher. This excludes platform startup and the
// evaluation of this small module; it is not a full Vercel cold-start duration.
export const dispatcherImportStartedAt = performance.now();
const instanceId = randomUUID();
const requests = new AsyncLocalStorage<TimingContext>();

type Stage =
  | "runtime_init"
  | "db_checkout"
  | "db_connect"
  | "snapshot"
  | "revision_read"
  | "movie_rows"
  | "movie_codes"
  | "response_json";
interface TimingContext {
  stages: Partial<Record<Stage, { ms: number; count: number; errors: number }>>;
  active: Set<{ stage: Stage; started: number }>;
}

export function recordCatalogTiming(
  stage: Stage,
  ms: number,
  failed = false,
): void {
  const context = requests.getStore();
  if (!context) return;
  const entry = (context.stages[stage] ??= { ms: 0, count: 0, errors: 0 });
  entry.ms += ms;
  entry.count++;
  if (failed) entry.errors++;
}

export function startCatalogTiming(stage: Stage) {
  const context = requests.getStore();
  if (!context) return () => undefined;
  const span = { stage, started: performance.now() };
  context.active.add(span);
  let done = false;
  return (failed = false) => {
    if (done) return;
    done = true;
    requests.run(context, () =>
      recordCatalogTiming(stage, performance.now() - span.started, failed),
    );
    context.active.delete(span);
  };
}

export async function timeCatalogStage<T>(
  stage: Stage,
  work: () => PromiseLike<T>,
): Promise<T> {
  const end = startCatalogTiming(stage);
  try {
    const result = await work();
    end();
    return result;
  } catch (error) {
    end(true);
    throw error;
  }
}

export function timeCatalogStageSync<T>(stage: Stage, work: () => T): T {
  const end = startCatalogTiming(stage);
  try {
    const result = work();
    end();
    return result;
  } catch (error) {
    end(true);
    throw error;
  }
}

export function withCatalogTiming<T>(
  url: string | undefined,
  response: Pick<ServerResponse, "once" | "statusCode" | "writableFinished">,
  metadata: { firstApiRequest: boolean; dispatcherImportMs: number },
  work: () => T,
  write: (line: string) => void = (line) => console.info(line),
): T {
  const path = url?.split("?", 1)[0];
  if (
    path !== "/api/v1/catalog/now-playing" &&
    path !== "/api/v1/catalog/coming-soon"
  )
    return work();

  const started = performance.now();
  const requestId = randomUUID();
  let logged = false;
  const context: TimingContext = {
    stages: {},
    active: new Set(),
  };
  const complete = (outcome: "finished" | "closed" | "threw") => {
    if (logged) return;
    logged = true;
    const completedAt = performance.now();
    try {
      const stages = structuredClone(context.stages) as Partial<
        Record<
          Stage,
          { ms: number; count: number; errors: number; inFlight?: number }
        >
      >;
      for (const span of context.active) {
        const entry = (stages[span.stage] ??= { ms: 0, count: 0, errors: 0 });
        entry.ms += completedAt - span.started;
        entry.count++;
        entry.inFlight = (entry.inFlight ?? 0) + 1;
      }
      write(
        JSON.stringify({
          event: "catalog_timing",
          requestId,
          instanceId,
          moduleAgeMs: started - dispatcherImportStartedAt,
          catalog: path.endsWith("now-playing") ? "nowPlaying" : "comingSoon",
          ...metadata,
          status: outcome === "threw" ? null : response.statusCode,
          outcome,
          responseFinishedMs: completedAt - started,
          stages,
        }),
      );
    } catch {
      // Diagnostics must never turn a successful response into a failure.
    }
  };
  response.once("finish", () => complete("finished"));
  response.once("close", () =>
    complete(response.writableFinished ? "finished" : "closed"),
  );
  return requests.run(context, () => {
    try {
      return work();
    } catch (error) {
      complete("threw");
      throw error;
    }
  });
}
