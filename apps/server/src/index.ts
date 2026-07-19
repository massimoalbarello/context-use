// Development convenience only. Production rejects SERVICE_MODE=all and
// starts one explicit entrypoint per capability from Compose.
import { combinedApp } from "./combined-app.ts";
import { config, production } from "./config.ts";
import { listenStorageSocket } from "./storage-app.ts";

if (production) throw new Error("The combined server is forbidden in production");

await listenStorageSocket();
Bun.serve({
  port: config.PORT,
  maxRequestBodySize: 5_100_000_000,
  fetch: (request) => combinedApp.handle(request),
});
console.info(`context-use combined development server listening on ${config.PORT}`);
