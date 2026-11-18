import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import pino, { type DestinationStream, type Logger } from "pino";

const redactedPaths = [
  "authorization",
  "cookie",
  "headers.authorization",
  "headers.cookie",
  "headers.set-cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.set-cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers.set-cookie",
  "body.password",
  "body.token",
  "body.secret",
  "req.body.password",
  "req.body.token",
  "req.body.secret",
  "request.body.password",
  "request.body.token",
  "request.body.secret",
  "request.databaseUrl",
  "request.connectionString",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "databaseUrl",
  "connectionString",
];

export interface RequestLogContext {
  requestId: string;
  logger: Logger;
}

const requestContext = new AsyncLocalStorage<RequestLogContext>();

export function resolveLogLevel(value?: string): pino.LevelWithSilent {
  const candidate = value?.trim().toLowerCase();
  if (
    candidate === "trace" ||
    candidate === "debug" ||
    candidate === "info" ||
    candidate === "warn" ||
    candidate === "error" ||
    candidate === "fatal" ||
    candidate === "silent"
  ) {
    return candidate;
  }
  return "info";
}

export function createServerLogger(
  destination: DestinationStream = pino.destination(1),
  level = process.env.LOG_LEVEL,
): Logger {
  return pino(
    {
      name: "kartiseret-api",
      level: resolveLogLevel(level),
      base: {
        service: "kartiseret-api",
        environment:
          process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: redactedPaths, censor: "[Redacted]" },
    },
    destination,
  );
}

export const serverLogger = createServerLogger(
  undefined,
  process.env.NODE_ENV === "test" ? "silent" : process.env.LOG_LEVEL,
);

export function logErrorSafely(
  event: string,
  error: unknown,
  message: string,
): void {
  try {
    getRequestLogger().error(
      { event, error: safeErrorSummary(error) },
      message,
    );
  } catch {
    // Diagnostics must not change the response path or interrupt shutdown.
  }
}

export function createRequestLogContext(
  rootLogger: Logger = serverLogger,
  requestId: string = randomUUID(),
): RequestLogContext {
  return { requestId, logger: rootLogger.child({ requestId }) };
}

export function getRequestLogContext(): RequestLogContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function getRequestLogger(): Logger {
  return requestContext.getStore()?.logger ?? serverLogger;
}

export function withRequestLogContext<Value>(
  work: () => Value,
  rootLogger: Logger = serverLogger,
  requestId?: string,
): Value {
  const parent = requestContext.getStore();
  return requestContext.run(
    parent ?? createRequestLogContext(rootLogger, requestId),
    work,
  );
}

export interface SafeErrorSummary {
  name: string;
  code?: string;
  cause?: SafeErrorSummary;
}

export function safeErrorSummary(
  error: unknown,
  causeDepth = 0,
): SafeErrorSummary {
  if (typeof error !== "object" || error === null) {
    return { name: "UnknownError" };
  }

  const source = error as {
    name?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  return {
    name: typeof source.name === "string" ? source.name : "Error",
    ...(typeof source.code === "string" ? { code: source.code } : {}),
    ...(causeDepth < 4 &&
    typeof source.cause === "object" &&
    source.cause !== null
      ? { cause: safeErrorSummary(source.cause, causeDepth + 1) }
      : {}),
  };
}
