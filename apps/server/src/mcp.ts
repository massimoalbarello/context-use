import { AssetRepository, PageRepository } from "@context-use/database";
import {
  archivePageSchema,
  createPageSchema,
  updatePageSchema,
} from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import { authPool } from "./auth.ts";
import { config } from "./config.ts";
import { createStatelessMcpTransport, unsupportedMcpMethodResponse } from "./mcp-transport.ts";
import { ownerUserId } from "./owner.ts";
import type { ObjectStorage } from "./storage.ts";

type McpContext = {
  clientId: string;
  userId: string;
  scopes: Set<string>;
};

function mcpUnauthorized(message: string): Response {
  return new Response(message, {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": `Bearer resource_metadata="${config.APP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    },
  });
}

function scopesFromJwt(jwt: JWTPayload): Set<string> {
  const value = jwt.scope;
  if (typeof value === "string") return new Set(value.split(/\s+/).filter(Boolean));
  if (Array.isArray(value)) return new Set(value.filter((item): item is string => typeof item === "string"));
  const plural = jwt.scopes;
  return new Set(Array.isArray(plural) ? plural.filter((item): item is string => typeof item === "string") : []);
}

async function contextFromJwt(jwt: JWTPayload): Promise<McpContext | null> {
  const clientId = typeof jwt.azp === "string" ? jwt.azp : null;
  const userId = typeof jwt.sub === "string" ? jwt.sub : null;
  if (!clientId || !userId || jwt.principal_type !== "mcp_agent") return null;
  const scopes = scopesFromJwt(jwt);
  const result = await authPool.query(
    `SELECT 1
     FROM "oauthClient" client
     JOIN "oauthConsent" consent ON consent."clientId"=client."clientId"
     JOIN "user" owner ON owner.id=consent."userId"
     WHERE client."clientId"=$1 AND consent."userId"=$2
       AND coalesce(client.disabled,false)=false
       AND owner.id=$3 AND lower(owner.email)=lower($4) AND owner."emailVerified"=true
       AND consent.scopes @> $5::jsonb`,
    [clientId, userId, ownerUserId, config.OWNER_EMAIL, JSON.stringify([...scopes])],
  );
  if (!result.rowCount) return null;

  await authPool.query(
    `INSERT INTO mcp_client_usage(client_id,user_id,last_used_at) VALUES ($1,$2,now())
     ON CONFLICT (client_id,user_id) DO UPDATE SET last_used_at=excluded.last_used_at`,
    [clientId, userId],
  );
  return { clientId, userId, scopes };
}

function requireScope(context: McpContext, scope: "kb:read" | "kb:write" | "assets:read"): void {
  if (!context.scopes.has(scope)) throw new Error(`insufficient_scope:${scope}`);
}

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function createServer(context: McpContext, pages: PageRepository, assets: AssetRepository, storage: ObjectStorage): McpServer {
  const server = new McpServer({ name: "context-use", version: "0.1.6" });
  const actor = { kind: "mcp" as const, subject: context.clientId };

  server.registerTool("list_pages", {
    description: "List current knowledge pages. Archived pages are excluded unless requested.",
    inputSchema: z.object({ include_archived: z.boolean().default(false) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ include_archived }) => {
    requireScope(context, "kb:read");
    return jsonContent(await pages.list(include_archived));
  });

  server.registerTool("get_page", {
    description: "Get the current version of a knowledge page by stable UUID.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    requireScope(context, "kb:read");
    return jsonContent(await pages.get(page_id));
  });

  server.registerTool("search_pages", {
    description: "Full-text search current knowledge pages.",
    inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).default(30) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    requireScope(context, "kb:read");
    return jsonContent(await pages.search(query, limit));
  });

  server.registerTool("get_page_history", {
    description: "List immutable versions and commit attribution for a page.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    requireScope(context, "kb:read");
    return jsonContent(await pages.history(page_id));
  });

  server.registerTool("get_page_version", {
    description: "Read one immutable page version.",
    inputSchema: z.object({ page_id: z.string().uuid(), version_number: z.number().int().positive() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id, version_number }) => {
    requireScope(context, "kb:read");
    return jsonContent(await pages.version(page_id, version_number));
  });

  server.registerTool("get_page_links", {
    description: "Get current outgoing links from a page.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    requireScope(context, "kb:read");
    return jsonContent((await pages.links(page_id)).outgoing);
  });

  server.registerTool("get_backlinks", {
    description: "Get current pages that link to a page.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    requireScope(context, "kb:read");
    return jsonContent((await pages.links(page_id)).backlinks);
  });

  server.registerTool("create_page", {
    description: "Create a private Markdown page and its first immutable version.",
    inputSchema: createPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "kb:write");
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency.",
    inputSchema: updatePageSchema.extend({ page_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ page_id, ...input }) => {
    requireScope(context, "kb:write");
    return jsonContent(await pages.update(page_id, input, actor));
  });

  server.registerTool("archive_page", {
    description: "Archive an unpublished page. Published pages must be manually unpublished in the dashboard first.",
    inputSchema: archivePageSchema.extend({ page_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ page_id, ...input }) => {
    requireScope(context, "kb:write");
    return jsonContent(await pages.archive(page_id, input, actor));
  });

  server.registerTool("list_assets", {
    description: "List private asset metadata. Does not reveal S3 keys.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    requireScope(context, "assets:read");
    return jsonContent(await assets.list());
  });

  server.registerTool("get_asset", {
    description: "Get asset metadata and a five-minute authorized download URL.",
    inputSchema: z.object({ asset_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ asset_id }) => {
    requireScope(context, "assets:read");
    const asset = await assets.get(asset_id, true);
    if (!asset) return jsonContent(null);
    const download_url = await storage.createDownload({
      objectKey: asset.s3_object_key,
      filename: asset.filename,
      contentType: asset.content_type,
    });
    const { s3_object_key: _hidden, ...metadata } = asset;
    return jsonContent({ ...metadata, download_url, expires_in: 300 });
  });

  return server;
}

export function createMcpRequestHandler(pages: PageRepository, assets: AssetRepository, storage: ObjectStorage) {
  const jwks = createRemoteJWKSet(new URL(`${config.APP_ORIGIN}/api/auth/jwks`));

  return async (request: Request): Promise<Response> => {
    if (request.headers.has("cookie")) return mcpUnauthorized("Cookie credentials are not accepted by MCP");
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
    if (!match) return mcpUnauthorized("Bearer authorization is required");
    let jwt: JWTPayload;
    try {
      const verified = await jwtVerify(match[1]!, jwks, {
        issuer: config.OAUTH_ISSUER,
        audience: config.MCP_RESOURCE,
        algorithms: ["EdDSA"],
      });
      jwt = verified.payload;
    } catch {
      return mcpUnauthorized("Bearer token is invalid or expired");
    }
    const audiences = typeof jwt.aud === "string" ? [jwt.aud] : jwt.aud;
    if (!audiences || audiences.length !== 1 || audiences[0] !== config.MCP_RESOURCE || typeof jwt.exp !== "number") {
      return mcpUnauthorized("Bearer token is not bound exclusively to this MCP resource");
    }
    const context = await contextFromJwt(jwt);
    if (!context) return mcpUnauthorized("OAuth grant is inactive");
    const unsupportedMethod = unsupportedMcpMethodResponse(request);
    if (unsupportedMethod) return unsupportedMethod;
    const transport = createStatelessMcpTransport();
    const server = createServer(context, pages, assets, storage);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
