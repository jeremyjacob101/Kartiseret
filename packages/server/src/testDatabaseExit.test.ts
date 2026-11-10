import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const exitHelper = fileURLToPath(
  new URL("../scripts/exit-after-test-database-cleanup.mjs", import.meta.url),
);

describe("disposable database process exit", () => {
  it("preserves a failing test status despite an async beforeExit hook", () => {
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
        import { exitAfterTestDatabaseCleanup } from ${JSON.stringify(pathToFileURL(exitHelper).href)};
        process.on("beforeExit", () => process.exit(0));
        exitAfterTestDatabaseCleanup(7);
      `,
    ]);

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(7);
  });
});
