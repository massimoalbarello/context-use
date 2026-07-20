import {
  AssetRepository,
  AutomationRepository,
  PageRepository,
  createPool,
} from "@context-use/database";
import { MCP_SCOPES } from "@context-use/shared";
import { Elysia } from "elysia";
import { config } from "./config.ts";
import { json, routeError } from "./http.ts";
import { createMcpRequestHandler } from "./mcp.ts";
import { createMcpAssetDownloadHandler } from "./mcp-asset-download.ts";
import { createMcpAssetUploadHandler } from "./mcp-asset-upload.ts";
import { securityHeaders } from "./security.ts";
import { BrokeredStorage } from "./storage-client.ts";

const pool = createPool(config.MCP_DATABASE_URL, { application_name: "context-use-private-mcp" });
const pages = new PageRepository(pool);
const assets = new AssetRepository(pool);
const automations = new AutomationRepository(pool);
const storage = new BrokeredStorage({
  socketPath: config.STORAGE_SOCKET_PATH,
  token: config.STORAGE_MCP_TOKEN,
});
const mcp = createMcpRequestHandler(pages, assets, automations);
const upload = createMcpAssetUploadHandler(assets, storage);
const download = createMcpAssetDownloadHandler(assets, storage);
const protectedResourceMetadata = () => json({
  resource: config.MCP_RESOURCE,
  authorization_servers: [config.OAUTH_ISSUER],
  scopes_supported: [...MCP_SCOPES],
  bearer_methods_supported: ["header"],
  resource_name: "context-use personal knowledge base",
});

export const mcpApp = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "private-mcp" }))
  .get("/.well-known/oauth-protected-resource", protectedResourceMetadata)
  .get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata)
  .get("/mcp", ({ request }) => mcp(request))
  .post("/mcp", ({ request }) => mcp(request))
  .delete("/mcp", ({ request }) => mcp(request))
  .put("/api/mcp/assets/:id/content", ({ request, params }) => upload(request, params.id), { parse: "none" })
  .get("/api/mcp/assets/:id/content", ({ request, params }) => download(request, params.id));
