import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

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
