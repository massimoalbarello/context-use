import { config } from "./config.ts";
import { dashboardEdgeApp } from "./dashboard-edge-app.ts";

dashboardEdgeApp.listen(config.PORT);
console.info(`context-use dashboard edge listening on ${config.PORT}`);
