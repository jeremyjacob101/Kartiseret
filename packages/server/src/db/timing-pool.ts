import { Client, Pool, type PoolClient } from "pg";
import { recordCatalogTiming, timeCatalogStage } from "../catalog-timing.js";

const connections = new WeakMap<object, { started: number; ms: number }>();

/** Keep driver callbacks, errors, release behavior and pool settings intact. */
export class TimingClient extends Client {
  override connect(): Promise<void>;
  override connect(callback: (error: Error) => void): void;
  override connect(callback?: (error: Error) => void): void | Promise<void> {
    const started = performance.now();
    const finish = () =>
      connections.set(this, { started, ms: performance.now() - started });
    if (callback)
      return super.connect((error) => {
        finish();
        callback(error);
      });
    return super.connect().finally(finish);
  }
}

export class TimingPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: PoolCallback): void;
  override connect(callback?: PoolCallback): void | Promise<PoolClient> {
    // Drizzle transactions use the promise API. Other pool consumers retain
    // their original callback path (including auth and pool.query).
    if (callback)
      return super.connect((error, client, release) => {
        if (client) connections.delete(client);
        callback(error, client, release);
      });
    const started = performance.now();
    return timeCatalogStage("db_checkout", async () => {
      const client = await super.connect();
      const connection = connections.get(client);
      connections.delete(client);
      if (connection && connection.started >= started)
        recordCatalogTiming("db_connect", connection.ms);
      return client;
    });
  }
}

type PoolCallback = Parameters<Pool["connect"]>[0];
