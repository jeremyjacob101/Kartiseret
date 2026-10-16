import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";

describe("PostgreSQL database factory", () => {
  const supabaseCaCertificate =
    "-----BEGIN CERTIFICATE-----\ntrusted root\n-----END CERTIFICATE-----";

  it("uses a bounded local pool and closes it once", async () => {
    const connection = createDatabase(
      "postgresql://app:secret@127.0.0.1:5432/kartiseret_test",
      { poolMax: 2 },
    );

    expect(connection.pool.options.max).toBe(2);
    expect(connection.pool.options.connectionTimeoutMillis).toBe(5_000);
    expect(connection.pool.options.idleTimeoutMillis).toBe(30_000);
    expect(connection.pool.options.ssl).toBe(false);

    const firstClose = connection.close();
    expect(connection.close()).toBe(firstClose);
    await firstClose;
  });

  it("requires verified TLS for remote database connections", async () => {
    const connection = createDatabase(
      "postgresql://app:secret@aws-0-eu-central-2.pooler.supabase.com:6543/postgres",
      { poolMax: 1, sslCaCertificate: supabaseCaCertificate },
    );
    expect(connection.pool.options.ssl).toEqual({
      ca: supabaseCaCertificate,
      rejectUnauthorized: true,
    });
    await connection.close();

    expect(() =>
      createDatabase(
        "postgresql://app:secret@db.example.test:5432/kartiseret?sslmode=require",
      ),
    ).toThrow("Remote PostgreSQL URLs must use verified TLS");
  });
});
