import { app } from "./app.ts";
import { config } from "./config.ts";

app.listen(config.PORT);
console.info(`context-use listening on ${config.APP_ORIGIN}`);
