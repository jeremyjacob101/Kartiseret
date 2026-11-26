import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/db/client.js";
import { PostgresPublicRouteRegistry } from "../../src/page-routes.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const target = new URL(connectionString);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
) {
  throw new Error(
    "Public route tests require disposable local kartiseret_test.",
  );
}

const database = createDatabase(connectionString);
const registry = new PostgresPublicRouteRegistry(database.pool);

afterAll(async () => database.close());

describe("public route registry database permissions", () => {
  it("allocates routes and safely returns an existing code to the runtime role", async () => {
    const input = {
      destinationKey: `integration:${randomUUID()}`,
      kind: "page" as const,
      destinationId: "/",
    };

    const created = await registry.getOrCreate(input);
    const existing = await registry.getOrCreate(input);

    expect(created.code).toMatch(/^[a-z0-9]{8}$/);
    expect(existing).toEqual(created);
  });
});
