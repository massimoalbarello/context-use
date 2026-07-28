import {
  AssetRepository,
  AutomationRepository,
  DirectoryRepository,
  PageRepository,
  createPool,
} from "@context-use/database";
import { MCP_SCOPES } from "@context-use/shared";
import { Elysia } from "elysia";
import { config, MCP_EXECUTION_RESOURCE } from "./config.ts";
import { json, routeError } from "./http.ts";
import { createMcpRequestHandler } from "./mcp.ts";
import { createMcpAssetDownloadHandler } from "./mcp-asset-download.ts";
import { createMcpAssetUploadHandler } from "./mcp-asset-upload.ts";
import { securityHeaders } from "./security.ts";
import { BrokeredStorage } from "./storage-client.ts";

const pool = createPool(config.MCP_DATABASE_URL, { application_name: "context-use-private-mcp" });
const pages = new PageRepository(pool);
const directories = new DirectoryRepository(pool);
const assets = new AssetRepository(pool);
const automations = new AutomationRepository(pool);
const storage = new BrokeredStorage({
  socketPath: config.STORAGE_SOCKET_PATH,
  token: config.STORAGE_MCP_TOKEN,
});
const knowledgeMcp = createMcpRequestHandler("knowledge", pages, directories, assets, automations);
const executionMcp = createMcpRequestHandler("execution", pages, directories, assets, automations);
const upload = createMcpAssetUploadHandler(assets, storage);
const download = createMcpAssetDownloadHandler(assets, storage);
const protectedResourceMetadata = (profile: "knowledge" | "execution") => json({
  resource: profile === "execution" ? MCP_EXECUTION_RESOURCE : config.MCP_RESOURCE,
  authorization_servers: [config.OAUTH_ISSUER],
  scopes_supported: [...MCP_SCOPES],
  bearer_methods_supported: ["header"],
  resource_name: profile === "execution"
    ? "context-use automation execution"
    : "context-use personal knowledge base",
});

export const mcpApp = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/health", () => json({ status: "ok", service: "private-mcp" }))
  .get("/.well-known/oauth-protected-resource", () => protectedResourceMetadata("knowledge"))
  .get("/.well-known/oauth-protected-resource/mcp", () => protectedResourceMetadata("knowledge"))
  .get("/.well-known/oauth-protected-resource/mcp/execution", () => protectedResourceMetadata("execution"))
  .get("/mcp", ({ request }) => knowledgeMcp(request))
  .post("/mcp", ({ request }) => knowledgeMcp(request))
  .delete("/mcp", ({ request }) => knowledgeMcp(request))
  .get("/mcp/execution", ({ request }) => executionMcp(request))
  .post("/mcp/execution", ({ request }) => executionMcp(request))
  .delete("/mcp/execution", ({ request }) => executionMcp(request))
  .put("/api/mcp/assets/:id/content", ({ request, params }) => upload(request, params.id), { parse: "none" })
  .get("/api/mcp/assets/:id/content", ({ request, params }) => download(request, params.id));
