import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

// Load backend/.env from the process cwd before validating; a missing file is
// fine (every variable is optional except SESSION_SECRET).
try {
  process.loadEnvFile();
} catch {
  // No .env — the environment must already carry the required variables.
}

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[lawleit-api] refusing to boot: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const app = await buildApp(config);

// 0.0.0.0: the API runs in Fly.io's containers (ADR-0004), which have no
// loopback route to the platform's public entry.
try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Draining via app.close() also runs the onClose hook that ends the db pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().finally(() => process.exit(0));
  });
}
