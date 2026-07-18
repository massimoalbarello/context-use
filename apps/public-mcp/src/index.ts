import { PublicMcpRepository, PublicMessageRepository, createPool } from "@context-use/database";
import { config, publicMcpEndpoint, publicSiteOrigin } from "./config.ts";
import { createPublicMcpRequestHandler } from "./handler.ts";

const pool = createPool(config.PUBLIC_MCP_DATABASE_URL, {
  application_name: "context-use-public-mcp",
  max: 5,
});
const reader = new PublicMcpRepository(pool);
const messages = new PublicMessageRepository(pool);
const mcp = createPublicMcpRequestHandler(reader, messages, publicMcpEndpoint, publicSiteOrigin);

const server = Bun.serve({
  port: config.PORT,
  maxRequestBodySize: 128 * 1024,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") {
      return Response.json({ status: "ok", version: "0.1.18" }, {
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
    return mcp(request);
  },
});

async function shutdown(): Promise<void> {
  server.stop();
  await pool.end();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
console.info(`context-use public MCP listening at ${publicMcpEndpoint.href}`);
