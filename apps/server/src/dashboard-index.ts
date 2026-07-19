import { app } from "./app.ts";
import { config } from "./config.ts";

app.listen(config.PORT);
console.info(`context-use dashboard service listening on ${config.PORT}`);
