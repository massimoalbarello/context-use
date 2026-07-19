import { confirmationApp } from "./confirmation-app.ts";
import { config } from "./config.ts";

confirmationApp.listen(config.PORT);
console.info(`context-use confirmation service listening on ${config.PORT}`);
