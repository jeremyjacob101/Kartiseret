import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "./client.js";
import { TimingClient } from "./timing-pool.js";

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

  it("preserves pg client results from both connect APIs", async () => {
    const baseConnect = vi.spyOn(Client.prototype, "connect");
    baseConnect.mockImplementation(function (
      this: Client,
      callback?: Parameters<Client["connect"]>[0],
    ) {
      if (callback) {
        const forwardCallback = callback as (
          error: Error | null,
          client: Client,
        ) => void;
        forwardCallback(null, this);
        return;
      }
      return Promise.resolve(this);
    } as typeof Client.prototype.connect);

    try {
      const client = new TimingClient();
      await expect(client.connect()).resolves.toBe(client);

      const callback = vi.fn((error: null, connectedClient: Client) => {
        expect(error).toBeNull();
        expect(connectedClient).toBe(client);
      });
      client.connect(callback);
      expect(callback).toHaveBeenCalledWith(null, client);
    } finally {
      baseConnect.mockRestore();
    }
  });
});
