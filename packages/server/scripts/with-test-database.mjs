import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
const bootstrapScript = resolve(
  currentDirectory,
  "bootstrap-test-database.mjs",
);
const databaseName = "kartiseret_test";

function connectionUrl(username, password, port) {
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise((resolveClose) => server.close(resolveClose));
    throw new Error("Could not allocate a local PostgreSQL port.");
  }

  const { port } = address;
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

function run(command, args, environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolveRun(code);
        return;
      }

      resolveRun(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
    });
  });
}

const [separator, command, ...args] = process.argv.slice(2);
if (separator !== "--" || !command) {
  throw new Error(
    "Usage: node with-test-database.mjs -- <command> [arguments...].",
  );
}

const port = await findAvailablePort();
const databaseDirectory = await mkdtemp(join(tmpdir(), "kartiseret-pg-"));
const adminPassword = randomBytes(24).toString("hex");
const testDatabaseUrl = connectionUrl("postgres", adminPassword, port);
const environment = {
  ...process.env,
  DATABASE_URL: connectionUrl("kartiseret_api", "local-test-only", port),
  TEST_DATABASE_URL: testDatabaseUrl,
  PUBLICATION_DATABASE_URL: connectionUrl(
    "kartiseret_publisher_login",
    "local-test-only",
    port,
  ),
  PUBLICATION_DATABASE_TEST_MODE: "true",
};

const database = new EmbeddedPostgres({
  authMethod: "scram-sha-256",
  databaseDir: databaseDirectory,
  password: adminPassword,
  persistent: false,
  port,
  postgresFlags: ["-h", "127.0.0.1"],
  user: "postgres",
});

let started = false;
let exitCode = 1;
try {
  console.log("Starting disposable PostgreSQL 17 for database-backed tests.");
  await database.initialise();
  await database.start();
  started = true;
  await database.createDatabase(databaseName);

  exitCode = await run(process.execPath, [bootstrapScript], environment);
  if (exitCode === 0) {
    exitCode = await run(command, args, environment);
  }
} catch (error) {
  console.error(
    "Could not run tests with disposable PostgreSQL:",
    error instanceof Error ? error.message : error,
  );
} finally {
  try {
    if (started) await database.stop();
  } catch (error) {
    console.error(
      "Could not stop disposable PostgreSQL cleanly:",
      error instanceof Error ? error.message : error,
    );
    exitCode ||= 1;
  }
  await rm(databaseDirectory, { force: true, recursive: true });
}

process.exitCode = exitCode;
