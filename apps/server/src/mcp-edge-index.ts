import { config } from "./config.ts";
import { mcpEdgeApp } from "./mcp-edge-app.ts";

mcpEdgeApp.listen(config.PORT);
console.info(`context-use private MCP edge listening on ${config.PORT}`);
