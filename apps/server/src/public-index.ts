import { config } from "./config.ts";
import { publicApp } from "./public-app.ts";

publicApp.listen(config.PORT);
console.info(`context-use public web service listening on ${config.PORT}`);
