import { describe, expect, it } from "vitest";
import { parseServerEnvironment, ServerConfigurationError } from "./env.js";

describe("server environment parsing", () => {
  it("validates runtime config and applies conservative defaults", () => {
    expect(
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
      }),
    ).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      DATABASE_POOL_MAX: 5,
    });
  });

  it("rejects missing and non-Postgres runtime URLs without echoing secrets", () => {
    expect(() => parseServerEnvironment({})).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "https://user:password@example.test/private",
      }),
    ).toThrow("Expected a PostgreSQL connection URL.");
    try {
      parseServerEnvironment({ DATABASE_URL: "not-a-url" });
    } catch (error) {
      expect(String(error)).not.toContain("password");
    }
  });

  it("rejects out-of-range ports and pool sizes", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
        PORT: "70000",
      }),
    ).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
        DATABASE_POOL_MAX: "21",
      }),
    ).toThrow(ServerConfigurationError);
  });
});
