import { config } from "./config.ts";
import { mcpApp } from "./mcp-app.ts";

mcpApp.listen(config.PORT);
console.info(`context-use private MCP service listening on ${config.PORT}`);
