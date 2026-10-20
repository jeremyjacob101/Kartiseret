// Disposable CI provider boundary, never imported by application composition.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
const target = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
)
  throw new Error("Auth fixtures require disposable local kartiseret_test.");
const signingKey = "disposable-ci-provider-only";
const users = {
  "browser@example.test": {
    id: "00000000-0000-4000-8000-000000000081",
    email: "browser@example.test",
    user_metadata: { signup_location: "Haifa" },
  },
  "admin@example.test": {
    id: "00000000-0000-4000-8000-000000000082",
    email: "admin@example.test",
    user_metadata: {},
  },
};
function token(user) {
  const content =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
  return `${content}.${createHmac("sha256", signingKey).update(content).digest("base64url")}`;
}
function verify(value) {
  const [header, payload, signature] = value.split(".");
  const content = `${header}.${payload}`;
  if (!content || !signature) return null;
  const expected = createHmac("sha256", signingKey)
    .update(content)
    .digest("base64url");
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  )
    return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    return claims.exp > Date.now() / 1000
      ? Object.values(users).find((user) => user.id === claims.sub)
      : null;
  } catch {
    return null;
  }
}
const server = createServer(async (request, response) => {
  response.setHeader(
    "Access-Control-Allow-Origin",
    `http://127.0.0.1:${process.env.PR3_E2E_WEB_PORT ?? 4173}`,
  );
  response.setHeader(
    "Access-Control-Allow-Headers",
    "apikey,authorization,content-type,x-client-info,x-supabase-api-version",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/health") {
    response.end('{"status":"ok"}');
    return;
  }
  if (path === "/auth/v1/token") {
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw || "{}");
    const user = users[body.email];
    if (!user || body.password !== "local-fixture-only") {
      response
        .writeHead(400)
        .end(
          '{"error_code":"invalid_credentials","msg":"Invalid credentials"}',
        );
      return;
    }
    response.end(
      JSON.stringify({
        access_token: token(user),
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `fixture-${user.id}`,
        user: {
          ...user,
          aud: "authenticated",
          role: "authenticated",
          created_at: "2026-10-19T12:00:00Z",
          email_confirmed_at: "2026-10-19T12:00:00Z",
          app_metadata: { provider: "email" },
        },
      }),
    );
    return;
  }
  if (path === "/auth/v1/user") {
    const user = verify(
      request.headers.authorization?.replace(/^Bearer /i, "") ?? "",
    );
    if (!user) {
      response.writeHead(401).end('{"message":"Invalid or expired session"}');
      return;
    }
    response.end(JSON.stringify(user));
    return;
  }
  if (path === "/auth/v1/logout") {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404).end("{}");
});
server.listen(Number(process.env.E2E_AUTH_PORT ?? 3211), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
