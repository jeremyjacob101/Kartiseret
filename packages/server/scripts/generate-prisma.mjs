import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generationOnlyUrl =
  "postgresql://prisma-generate:unused@127.0.0.1:1/prisma_generate_only?schema=public";
const env = {
  ...process.env,
  // Keep generation independent of the operator's runtime/admin credentials.
  DATABASE_URL: generationOnlyUrl,
};
const executable = process.platform === "win32" ? "prisma.cmd" : "prisma";
const result = spawnSync(
  executable,
  ["generate", "--config", "prisma.config.ts"],
  {
    cwd: packageRoot,
    env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
