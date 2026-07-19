import { authApp } from "./auth-app.ts";
import { config } from "./config.ts";

authApp.listen(config.PORT);
console.info(`context-use auth service listening on ${config.PORT}`);
