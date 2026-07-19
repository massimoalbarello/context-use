import { authEdgeApp } from "./auth-edge-app.ts";
import { config } from "./config.ts";

authEdgeApp.listen(config.PORT);
console.info(`context-use authentication edge listening on ${config.PORT}`);
