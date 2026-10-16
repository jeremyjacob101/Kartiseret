import { createProductionApp } from "./production.js";

const { app, config, close } = createProductionApp();
const server = app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`Kartiseret API listening on port ${config.PORT}.`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}; closing the API server.`);

  server.close(async (error) => {
    if (error) {
      console.error("Could not close the API server cleanly.", error);
      process.exitCode = 1;
    }
    await close();
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
