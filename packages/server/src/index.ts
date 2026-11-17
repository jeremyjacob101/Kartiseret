import { createProductionApp } from "./production.js";
import { getRequestLogger, safeErrorSummary } from "./logging.js";

const { app, config, close } = createProductionApp();
const server = app.listen(config.PORT, "0.0.0.0", () => {
  getRequestLogger().info(
    { event: "api_server_started", port: config.PORT },
    "Kartiseret API listening.",
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  getRequestLogger().info(
    { event: "api_server_shutdown_started", signal },
    "Received shutdown signal; closing the API server.",
  );

  server.close(async (error) => {
    if (error) {
      getRequestLogger().error(
        {
          event: "api_server_shutdown_failed",
          error: safeErrorSummary(error),
        },
        "Could not close the API server cleanly.",
      );
      process.exitCode = 1;
    }
    await close();
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
