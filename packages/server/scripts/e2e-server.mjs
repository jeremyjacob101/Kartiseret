// CI-only composition: real Better Auth/Drizzle and captured email, never a deployed route.
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { createApplicationAuth } from "../dist/auth/auth.js";
import { BetterAuthIdentityVerifier } from "../dist/protected/identity.js";
import { createRecipientRouter } from "../dist/auth/recipients.js";
import { createDatabase } from "../dist/db/client.js";
import { createApp } from "../dist/app.js";
import { ProtectedWorkflows } from "../dist/protected/service.js";
import { DrizzleCatalogRepository } from "../dist/catalog/drizzle-repository.js";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  process.env.NODE_ENV !== "test" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
) {
  throw new Error(
    "The E2E composition requires the disposable local kartiseret_test database.",
  );
}
const database = createDatabase(target.href, { poolMax: 3 });
const baseURL = process.env.E2E_WEB_URL;
if (!baseURL || new URL(baseURL).hostname !== "127.0.0.1")
  throw new Error("E2E auth origin must be local.");
const mail = [];
const auth = createApplicationAuth(database.pool, {
  baseURL,
  secret: "ci-only-auth-secret-with-at-least-32-characters",
  cookiePrefix: "kartiseret-ci",
  trustedOrigins: [baseURL],
  mailer: async (email) => {
    mail.push(email);
  },
});
for (const email of ["browser@example.test", "admin@example.test"]) {
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${baseURL}/reset-password` },
  });
  const message = mail.findLast(
    (item) => item.to === email && item.kind === "reset",
  );
  const token = new URL(message.url).pathname.split("/").at(-1);
  await auth.api.resetPassword({
    body: { token, newPassword: "local-fixture-only" },
  });
}
mail.length = 0;
const repository = new DrizzleCatalogRepository(database.db);
const app = express();
app.get("/__test/mail", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(mail.filter((item) => item.to === request.query.email));
});
app.use(
  createApp({
    catalogRepository: repository,
    publicDataRepository: repository,
    protectedWorkflows: new ProtectedWorkflows(database.db, repository),
    identityVerifier: new BetterAuthIdentityVerifier(auth),
    authHandler: toNodeHandler(auth),
    recipientRouter: createRecipientRouter(
      database.pool,
      "ci-only-internal-secret-at-least-32-characters",
    ),
    trustedOrigins: [baseURL],
  }),
);
const server = app.listen(Number(process.env.PORT), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close(() => {
      void database.close().finally(() => process.exit(0));
    });
  });
