import { resolve } from "node:path";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import {
  AssetRepository,
  AutomationRepository,
  AutomationValidationError,
  AutomationVersionConflictError,
  InboxRepository,
  PageRepository,
  PublicationRepository,
  PublicRepository,
  PublicationStateError,
  VersionConflictError,
  createPool,
  extractAssetLinks,
  extractPageLinks,
  extractWikiLinks,
  wikiLinkCandidatePaths,
} from "@context-use/database";
import {
  assetUploadSchema,
  archivePageSchema,
  createAutomationSkillSchema,
  createCronScheduleSchema,
  createPageSchema,
  MCP_SCOPES,
  publicationIntentSchema,
  updateAutomationSkillSchema,
  updateCronScheduleSchema,
  updatePageSchema,
} from "@context-use/shared";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { Elysia } from "elysia";
import { z } from "zod";
import { auth, authPool, dashboardPrincipal } from "./auth.ts";
import { assetContentResponse } from "./asset-content.ts";
import { config, production } from "./config.ts";
import { publicationWarnings, renderMarkdown } from "./markdown.ts";
import { createMcpRequestHandler, isMcpGrantActive } from "./mcp.ts";
import { createMcpAssetDownloadHandler } from "./mcp-asset-download.ts";
import { createMcpAssetUploadHandler } from "./mcp-asset-upload.ts";
import { authorizePasskeyAuthRequest } from "./passkey-boundary.ts";
import { createPublicAssetContentHandler } from "./public-asset-content.ts";
import {
  SecurityError,
  assertDashboardRequestSecurity,
  assertDashboardUploadSecurity,
  csrfToken,
  requestMatchesOrigin,
  securityHeaders,
} from "./security.ts";
import { AssetIntegrityError, storage } from "./storage.ts";
import { requireAuthenticationUserVerification } from "./webauthn-policy.ts";

const dashboardPool = createPool(config.DATABASE_URL);
const mcpPool = createPool(config.MCP_DATABASE_URL);
const publicPool = createPool(config.PUBLIC_DATABASE_URL);
const publisherPool = createPool(config.PUBLISHER_DATABASE_URL);

const dashboardPages = new PageRepository(dashboardPool);
const dashboardAssets = new AssetRepository(dashboardPool);
const dashboardAutomations = new AutomationRepository(dashboardPool);
const dashboardInbox = new InboxRepository(dashboardPool);
const mcpPages = new PageRepository(mcpPool);
const mcpAssets = new AssetRepository(mcpPool);
const mcpAutomations = new AutomationRepository(mcpPool);
const publicData = new PublicRepository(publicPool);
const publications = new PublicationRepository(dashboardPool, publisherPool);
const mcp = createMcpRequestHandler(mcpPages, mcpAssets, mcpAutomations);
const mcpAssetUpload = createMcpAssetUploadHandler(mcpAssets, storage, isMcpGrantActive);
const mcpAssetDownload = createMcpAssetDownloadHandler(mcpAssets, storage, isMcpGrantActive);
const publicAssetContent = createPublicAssetContentHandler(publicData, storage, config.ASSET_ORIGIN);

const authServerMetadata = oauthProviderAuthServerMetadata(auth as never);
const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth as never);

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}

function problem(message: string, status = 400, code = "bad_request"): Response {
  return json({ error: code, message }, status);
}

async function bodyJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 2_100_000) throw new SecurityError("Request body too large", 413);
  return request.json();
}

async function ownerRequest(request: Request, mutation = false) {
  if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
  const principal = await dashboardPrincipal(request);
  if (!principal) throw new SecurityError("Dashboard session required", 401);
  if (mutation) assertDashboardRequestSecurity(request, principal);
  return principal;
}

function routeError(error: unknown): Response {
  if (error instanceof SecurityError) return problem(error.message, error.status, "security_error");
  if (error instanceof VersionConflictError) {
    return json({ error: "version_conflict", current_version_number: error.currentVersion }, 409);
  }
  if (error instanceof PublicationStateError) return problem(error.message, 409, "publication_state");
  if (error instanceof AutomationValidationError) return problem(error.message, 422, "automation_validation");
  if (error instanceof AutomationVersionConflictError) {
    return json({ error: "version_conflict", current_version_number: error.currentVersion }, 409);
  }
  if (error instanceof z.ZodError) return json({ error: "validation_error", issues: error.issues }, 422);
  if (error instanceof Error && "code" in error) {
    const code = String((error as Error & { code: unknown }).code);
    if (code === "23505") return problem("A unique value is already in use", 409, "conflict");
    if (code === "42501") return problem("Operation denied by the database security policy", 403, "forbidden");
    if (code === "23514") return problem("Write violates a knowledge ownership boundary", 422, "ownership_boundary");
  }
  console.error("request_failed", error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
  return problem("Internal server error", 500, "internal_error");
}

function privatePageResolvers(sourcePath: string) {
  return {
    page: async (id: string) => {
      const page = await dashboardPages.get(id);
      return page ? { available: true as const, href: `/app/pages/${id}` } : { available: false as const };
    },
    pagePath: async (path: string) => {
      for (const candidate of wikiLinkCandidatePaths(path, sourcePath)) {
        const page = await dashboardPages.getByPath(candidate);
        if (page) return { available: true as const, href: `/app/pages/${page.id}` };
      }
      return { available: false as const };
    },
    asset: async (id: string) => {
      const asset = await dashboardAssets.get(id);
      return asset ? { available: true as const, href: `/api/dashboard/assets/${id}/content` } : { available: false as const };
    },
  };
}

// This resolver intentionally has no dashboard repository fallback. Public
// rendering can observe only the security-barrier views available to the
// context_use_public database role.
function publicPageResolvers(sourcePath: string) {
  return {
    page: async (id: string) => {
      const page = await publicData.pageById(id);
      return page ? { available: true as const, href: `/p/${page.public_slug}` } : { available: false as const };
    },
    pagePath: async (path: string) => {
      for (const candidate of wikiLinkCandidatePaths(path, sourcePath)) {
        const page = await publicData.pageByPath(candidate);
        if (page) return { available: true as const, href: `/p/${page.public_slug}` };
      }
      return { available: false as const };
    },
    asset: async (id: string) => {
      const asset = await publicData.asset(id);
      return asset
        ? { available: true as const, href: `${config.ASSET_ORIGIN}/api/public/assets/${id}/content` }
        : { available: false as const };
    },
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function getOwnerPasskeys(userId: string) {
  const result = await authPool.query<{
    id: string;
    name: string | null;
    publicKey: string;
    credentialID: string;
    counter: number;
    transports: string | null;
    createdAt: Date;
  }>(
    `SELECT id,name,"publicKey","credentialID",counter,transports,"createdAt" FROM passkey WHERE "userId"=$1 ORDER BY "createdAt"`,
    [userId],
  );
  return result.rows;
}

const confirmSchema = z.object({
  intent_id: z.string().uuid(),
  response: z.custom<AuthenticationResponseJSON>((value) => Boolean(value && typeof value === "object")),
}).strict();

const webRoot = resolve(config.WEB_DIST);
function webFile(path: string): Bun.BunFile | null {
  const resolved = resolve(webRoot, path);
  if (!resolved.startsWith(`${webRoot}/`)) return null;
  return Bun.file(resolved);
}

export const app = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/api/health", () => json({ status: "ok", version: "0.1.18" }))
  .all("/api/auth/*", async ({ request }) => {
    const boundary = await authorizePasskeyAuthRequest(request);
    if (boundary.denied) return boundary.denied;
    try {
      const pathname = new URL(request.url).pathname;
      const response = await requireAuthenticationUserVerification(pathname, await auth.handler(request));
      return response;
    } finally {
      await boundary.release?.();
    }
  })
  .get("/.well-known/oauth-authorization-server", ({ request }) => authServerMetadata(request))
  .get("/.well-known/openid-configuration", ({ request }) => openIdMetadata(request))
  .get("/.well-known/oauth-protected-resource", () => json({
    resource: config.MCP_RESOURCE,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "context-use personal knowledge base",
  }))
  .get("/.well-known/oauth-protected-resource/mcp", () => json({
    resource: config.MCP_RESOURCE,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  }))
  .get("/mcp", ({ request }) => mcp(request))
  .post("/mcp", ({ request }) => mcp(request))
  .delete("/mcp", ({ request }) => mcp(request))
  .put(
    "/api/mcp/assets/:id/content",
    ({ request, params }) => mcpAssetUpload(request, params.id),
    // Asset bytes are integrity-checked while streaming to storage. Never let
    // Elysia's content-type parser buffer or apply its ordinary body limit.
    { parse: "none" },
  )
  .get("/api/mcp/assets/:id/content", ({ request, params }) => mcpAssetDownload(request, params.id))

  .get("/app", async () => {
    const file = webFile("index.html");
    return file && await file.exists() ? new Response(file, { headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } }) : problem("Dashboard build not found", 503);
  })
  .get("/app/*", async () => {
    const file = webFile("index.html");
    return file && await file.exists() ? new Response(file, { headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } }) : problem("Dashboard build not found", 503);
  })
  .get("/assets/*", async ({ params }) => {
    const path = (params as Record<string, string>)["*"] ?? "";
    const file = webFile(`assets/${path}`);
    if (!file || !(await file.exists())) return new Response("Not found", { status: 404, headers: securityHeaders });
    return new Response(file, { headers: { ...securityHeaders, "cache-control": "public, max-age=31536000, immutable" } });
  })

  .get("/api/dashboard/session", async ({ request }) => {
    const principal = await ownerRequest(request);
    const passkeys = await getOwnerPasskeys(principal.userId);
    return json({
      owner: { id: principal.userId, email: principal.email },
      passkey_count: passkeys.length,
      passkeys: passkeys.map((key) => ({ id: key.id, name: key.name, created_at: key.createdAt })),
    });
  })
  .get("/api/dashboard/csrf", async ({ request }) => {
    const principal = await ownerRequest(request);
    return json({ csrf_token: csrfToken(principal) });
  })
  .get("/api/dashboard/oauth-clients", async ({ request }) => {
    const principal = await ownerRequest(request);
    const result = await authPool.query(
      `SELECT client."clientId" AS client_id,client.name,client.uri,client."createdAt" AS created_at,
              consent.scopes,consent."updatedAt" AS approved_at,usage.last_used_at
       FROM "oauthConsent" consent
       JOIN "oauthClient" client ON client."clientId"=consent."clientId"
       LEFT JOIN mcp_client_usage usage ON usage.client_id=client."clientId" AND usage.user_id=consent."userId"
       WHERE consent."userId"=$1
       ORDER BY consent."updatedAt" DESC`,
      [principal.userId],
    );
    return json(result.rows);
  })
  .get("/api/dashboard/messages", async ({ request }) => {
    const principal = await ownerRequest(request);
    return json(await dashboardInbox.listForOwner(principal.userId));
  })
  .get("/api/dashboard/oauth-client-preview", async ({ request, query }) => {
    await ownerRequest(request);
    const clientId = z.string().min(1).max(512).parse(query.client_id);
    const result = await authPool.query(
      `SELECT "clientId" AS client_id,name,uri,"redirectUris" AS redirect_uris,"softwareId" AS software_id,"softwareVersion" AS software_version
       FROM "oauthClient" WHERE "clientId"=$1 AND coalesce(disabled,false)=false`,
      [clientId],
    );
    return result.rows[0] ? json(result.rows[0]) : problem("OAuth client not found", 404, "not_found");
  })
  .delete("/api/dashboard/oauth-clients/:clientId", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const clientId = z.string().min(1).max(512).parse(params.clientId);
    const authClient = await authPool.connect();
    try {
      await authClient.query("BEGIN");
      const removed = await authClient.query(
        `DELETE FROM "oauthConsent" WHERE "clientId"=$1 AND "userId"=$2 RETURNING id`,
        [clientId, principal.userId],
      );
      if (!removed.rowCount) throw new SecurityError("Connected client not found", 404);
      await authClient.query(
        `UPDATE "oauthRefreshToken" SET revoked=now()
         WHERE "clientId"=$1 AND "userId"=$2 AND revoked IS NULL`,
        [clientId, principal.userId],
      );
      await authClient.query(
        `DELETE FROM "oauthAccessToken" WHERE "clientId"=$1 AND "userId"=$2`,
        [clientId, principal.userId],
      );
      await authClient.query("COMMIT");
    } catch (error) {
      await authClient.query("ROLLBACK");
      throw error;
    } finally {
      authClient.release();
    }
    return json({ revoked: true });
  })
  .get("/api/dashboard/skills", async ({ request }) => {
    await ownerRequest(request);
    return json(await dashboardAutomations.listSkills());
  })
  .post("/api/dashboard/skills", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = createAutomationSkillSchema.parse(await bodyJson(request));
    return json(await dashboardAutomations.createSkill(input, { kind: "dashboard", subject: principal.userId }), 201);
  })
  .put("/api/dashboard/skills/:id", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = updateAutomationSkillSchema.parse(await bodyJson(request));
    const skill = await dashboardAutomations.updateSkill(
      z.string().uuid().parse(params.id),
      input,
      { kind: "dashboard", subject: principal.userId },
    );
    return skill ? json(skill) : problem("Skill not found", 404, "not_found");
  })
  .get("/api/dashboard/automations/schedules", async ({ request }) => {
    await ownerRequest(request);
    return json(await dashboardAutomations.listSchedules());
  })
  .post("/api/dashboard/automations/schedules", async ({ request }) => {
    await ownerRequest(request, true);
    const input = createCronScheduleSchema.parse(await bodyJson(request));
    return json(await dashboardAutomations.createSchedule(input), 201);
  })
  .put("/api/dashboard/automations/schedules/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const input = updateCronScheduleSchema.parse(await bodyJson(request));
    const schedule = await dashboardAutomations.updateSchedule(z.string().uuid().parse(params.id), input);
    return schedule ? json(schedule) : problem("Cron schedule not found", 404, "not_found");
  })
  .get("/api/dashboard/automations/runs", async ({ request, query }) => {
    await ownerRequest(request);
    const limit = z.coerce.number().int().min(1).max(500).default(200).parse(query.limit);
    return json(await dashboardAutomations.listRuns(limit));
  })
  .get("/api/dashboard/pages", async ({ request, query }) => {
    await ownerRequest(request);
    if (typeof query.q === "string" && query.q.trim()) return json(await dashboardPages.search(query.q));
    return json(await dashboardPages.list(query.archived === "true"));
  })
  .post("/api/dashboard/pages", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = createPageSchema.parse(await bodyJson(request));
    return json(await dashboardPages.create(input, { kind: "dashboard", subject: principal.userId }), 201);
  })
  .get("/api/dashboard/pages/:id", async ({ request, params }) => {
    await ownerRequest(request);
    const page = await dashboardPages.get(z.string().uuid().parse(params.id));
    if (!page) return problem("Page not found", 404, "not_found");
    const html = await renderMarkdown(page.body_markdown, privatePageResolvers(page.current_path));
    return json({ ...page, rendered_html: html });
  })
  .put("/api/dashboard/pages/:id", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = updatePageSchema.parse(await bodyJson(request));
    const page = await dashboardPages.update(z.string().uuid().parse(params.id), input, { kind: "dashboard", subject: principal.userId });
    return page ? json(page) : problem("Page not found", 404, "not_found");
  })
  .post("/api/dashboard/pages/:id/archive", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = archivePageSchema.parse(await bodyJson(request));
    const page = await dashboardPages.archive(z.string().uuid().parse(params.id), input, { kind: "dashboard", subject: principal.userId });
    return page ? json(page) : problem("Page not found", 404, "not_found");
  })
  .get("/api/dashboard/pages/:id/history", async ({ request, params }) => {
    await ownerRequest(request);
    return json(await dashboardPages.history(z.string().uuid().parse(params.id)));
  })
  .get("/api/dashboard/pages/:id/versions/:version", async ({ request, params }) => {
    await ownerRequest(request);
    const version = await dashboardPages.version(
      z.string().uuid().parse(params.id),
      z.coerce.number().int().positive().parse(params.version),
    );
    return version ? json(version) : problem("Version not found", 404, "not_found");
  })
  .get("/api/dashboard/pages/:id/publication-preview", async ({ request, params, query }) => {
    await ownerRequest(request);
    const pageId = z.string().uuid().parse(params.id);
    const page = await dashboardPages.get(pageId);
    if (!page) return problem("Page not found", 404, "not_found");
    const versionNumber = query.version ? z.coerce.number().int().positive().parse(query.version) : page.version_number;
    const version = await dashboardPages.version(pageId, versionNumber);
    if (!version) return problem("Version not found", 404, "not_found");
    const html = await renderMarkdown(version.body_markdown, publicPageResolvers(version.path));
    const references = await Promise.all([
      ...extractPageLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardPages.get(id);
        return { kind: "page" as const, id, label: target?.title ?? "Missing page", path: target?.current_path ?? null, public: Boolean(target?.published_version_id) };
      }),
      ...extractWikiLinks(version.body_markdown).map(async ({ path, label }) => {
        let target = null;
        for (const candidate of wikiLinkCandidatePaths(path, version.path)) {
          target = await dashboardPages.getByPath(candidate);
          if (target) break;
        }
        return {
          kind: "page" as const,
          id: target?.id ?? `path:${path}`,
          label: target?.title ?? label,
          path: target?.current_path ?? path,
          public: Boolean(target?.published_version_id),
        };
      }),
      ...extractAssetLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardAssets.get(id);
        return { kind: "asset" as const, id, label: target?.filename ?? "Missing asset", path: target?.current_path ?? null, public: Boolean(target?.published_at) };
      }),
    ]);
    return json({
      page_id: pageId,
      version_id: version.id,
      version_number: version.version_number,
      title: version.title,
      path: version.path,
      rendered_html: html,
      current_slug: page.public_slug,
      warnings: publicationWarnings(version.body_markdown),
      references,
    });
  })

  .get("/api/dashboard/assets", async ({ request }) => {
    await ownerRequest(request);
    return json(await dashboardAssets.list());
  })
  .post("/api/dashboard/assets/upload-intent", async ({ request }) => {
    await ownerRequest(request, true);
    const input = assetUploadSchema.parse(await bodyJson(request));
    const created = await dashboardAssets.create({
      currentPath: input.path,
      filename: input.filename,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
      contentHash: input.sha256,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
    });
    const { objectKey: _hidden, ...asset } = created;
    return json({ asset }, 201);
  })
  // Keep large dashboard recovery uploads on the raw streaming path too.
  .put("/api/dashboard/assets/:id/content", async ({ request, params }) => {
    const principal = await ownerRequest(request);
    assertDashboardUploadSecurity(request, principal);
    const asset = await dashboardAssets.get(z.string().uuid().parse(params.id), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    const expectedSize = Number(asset.size_bytes);
    const suppliedSize = request.headers.get("content-length");
    if (suppliedSize !== null && (!/^\d+$/.test(suppliedSize) || Number(suppliedSize) !== expectedSize)) {
      return problem("Asset size mismatch", 422, "integrity_error");
    }
    if (request.headers.get("content-type")?.toLowerCase() !== asset.content_type.toLowerCase()) {
      return problem("Asset content type mismatch", 422, "integrity_error");
    }
    if (!request.body && expectedSize !== 0) return problem("Asset size mismatch", 422, "integrity_error");
    try {
      await storage.write({
        id: asset.id,
        objectKey: asset.s3_object_key,
        filename: asset.filename,
        contentType: asset.content_type,
        sizeBytes: expectedSize,
        contentHash: asset.content_hash,
      }, request.body);
    } catch (error) {
      if (error instanceof AssetIntegrityError) return problem(error.message, 422, "integrity_error");
      throw error;
    }
    return json({ uploaded: true });
  }, { parse: "none" })
  .get("/api/dashboard/assets/:id/status", async ({ request, params }) => {
    await ownerRequest(request);
    const asset = await dashboardAssets.get(z.string().uuid().parse(params.id), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    return json({
      content_available: await storage.verify(
        asset.s3_object_key,
        Number(asset.size_bytes),
        asset.content_hash,
      ),
      public_url: `${config.ASSET_ORIGIN}/api/public/assets/${asset.id}/content`,
    });
  })
  .get("/api/dashboard/assets/:id/content", async ({ request, params }) => {
    await ownerRequest(request);
    const asset = await dashboardAssets.get(z.string().uuid().parse(params.id), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    return assetContentResponse(request, asset, storage, true);
  })
  .delete("/api/dashboard/assets/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const objectKey = await dashboardAssets.markDeleted(z.string().uuid().parse(params.id));
    if (!objectKey) return problem("Published or referenced asset cannot be deleted", 409, "asset_in_use");
    await storage.delete(objectKey);
    return json({ deleted: true });
  })

  .post("/api/dashboard/publication-intents", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = publicationIntentSchema.parse(await bodyJson(request));
    const passkeys = await getOwnerPasskeys(principal.userId);
    if (!passkeys.length) return problem("Register a passkey before changing visibility", 409, "passkey_required");

    if (input.target_kind === "page") {
      const page = await dashboardPages.get(input.target_id);
      if (!page) return problem("Page not found", 404, "not_found");
      if (page.automation_id && input.action !== "unpublish") {
        return problem("Automation-generated pages remain private", 403, "automation_page_private");
      }
      if (input.action !== "unpublish") {
        if (!input.version_id || !input.public_slug) return problem("Page version and public slug are required", 422);
        const history = await dashboardPages.history(input.target_id);
        if (!history.some((version) => version.id === input.version_id)) return problem("Version does not belong to page", 422);
      }
    } else {
      const asset = await dashboardAssets.get(input.target_id, true);
      if (!asset) return problem("Asset not found", 404, "not_found");
      if (input.action !== "unpublish" && !(await storage.verify(asset.s3_object_key, Number(asset.size_bytes), asset.content_hash))) {
        return problem("Asset upload is incomplete or failed integrity verification", 409, "asset_incomplete");
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: config.WEBAUTHN_RP_ID,
      userVerification: "required",
      timeout: 300_000,
      allowCredentials: passkeys.map((key) => ({
        id: key.credentialID,
        ...(key.transports
          ? { transports: key.transports.split(",").filter(Boolean) as AuthenticatorTransportFuture[] }
          : {}),
      })),
    });
    const intent = await publications.createIntent(input, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    }, options.challenge);
    return json({ intent, authentication_options: options }, 201);
  })
  .post("/api/dashboard/publications/confirm", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = confirmSchema.parse(await bodyJson(request));
    const intent = await publications.getIntent(input.intent_id);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Publication intent not found", 404, "not_found");
    }
    if (intent.consumed_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("Publication intent is expired or already used", 409, "intent_inactive");
    }
    const passkey = (await getOwnerPasskeys(principal.userId)).find((key) => key.credentialID === input.response.id);
    if (!passkey) return problem("Passkey is not registered to the owner", 403, "passkey_invalid");
    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: intent.challenge,
      expectedOrigin: config.APP_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      credential: {
        id: passkey.credentialID,
        publicKey: Buffer.from(passkey.publicKey, "base64"),
        counter: passkey.counter,
        ...(passkey.transports
          ? { transports: passkey.transports.split(",").filter(Boolean) as AuthenticatorTransportFuture[] }
          : {}),
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      return problem("Passkey verification failed", 403, "passkey_invalid");
    }
    await authPool.query("UPDATE passkey SET counter=$2 WHERE id=$1 AND counter<=$2", [
      passkey.id,
      verification.authenticationInfo.newCounter,
    ]);
    await publications.confirm(input.intent_id, principal.userId, principal.sessionId, passkey.credentialID);
    return json({ published: intent.action !== "unpublish", action: intent.action, target_kind: intent.target_kind, target_id: intent.target_id });
  })

  .get("/p/:slug", async ({ params }) => {
    const parsedSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/).safeParse(params.slug);
    if (!parsedSlug.success) return new Response("Not found", { status: 404, headers: securityHeaders });
    const slug = parsedSlug.data;
    const page = await publicData.pageBySlug(slug);
    if (!page) return new Response("Not found", { status: 404, headers: securityHeaders });
    const content = await renderMarkdown(page.body_markdown, publicPageResolvers(page.path));
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(page.title)}</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-page"><article>${content}</article></main></body></html>`;
    return new Response(html, { headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
  })
  .get("/", async () => {
    const home = await publicData.pageBySlug("home");
    return home
      ? new Response(null, { status: 302, headers: { ...securityHeaders, location: `${config.APP_ORIGIN}/p/home` } })
      : new Response("context-use", { headers: securityHeaders });
  })
  .get("/public.css", () => new Response(
    "body{margin:0;background:#f7f7f4;color:#20201d;font:17px/1.65 ui-serif,Georgia,serif}.public-page{max-width:760px;margin:8vh auto;padding:0 24px}h1,h2,h3{line-height:1.2}a{color:#315a4a}.private-reference{color:#777;font-style:italic}pre{overflow:auto;padding:16px;background:#ecece7;border-radius:8px}img{max-width:100%;height:auto}",
    { headers: { ...securityHeaders, "content-type": "text/css; charset=utf-8" } },
  ))
  .get("/api/public/assets/:assetId/content", ({ request, params }) => publicAssetContent(request, params.assetId));

if (production) {
  console.info("security_mode", {
    dashboard_auth: "cookie-only",
    mcp_auth: "bearer-only",
    publication: "webauthn-required",
  });
}
