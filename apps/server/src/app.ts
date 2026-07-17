import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import {
  AssetRepository,
  PageRepository,
  PublicationRepository,
  PublicRepository,
  PublicationStateError,
  VersionConflictError,
  createPool,
  extractAssetLinks,
  extractPageLinks,
} from "@context-use/database";
import {
  archivePageSchema,
  createPageSchema,
  publicationIntentSchema,
  restorePageSchema,
  updatePageSchema,
} from "@context-use/shared";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { Elysia } from "elysia";
import { z } from "zod";
import { auth, authPool, dashboardPrincipal } from "./auth.ts";
import { config, production } from "./config.ts";
import { publicationWarnings, renderMarkdown } from "./markdown.ts";
import { createMcpRequestHandler } from "./mcp.ts";
import { ownerUserId } from "./owner.ts";
import { authorizePasskeyAuthRequest } from "./passkey-boundary.ts";
import {
  SecurityError,
  assertDashboardRequestSecurity,
  csrfToken,
  securityHeaders,
} from "./security.ts";
import { contentDisposition, mayRenderInline, storage } from "./storage.ts";
import { requireAuthenticationUserVerification } from "./webauthn-policy.ts";

const dashboardPool = createPool(config.DATABASE_URL);
const mcpPool = createPool(config.MCP_DATABASE_URL);
const publicPool = createPool(config.PUBLIC_DATABASE_URL);
const publisherPool = createPool(config.PUBLISHER_DATABASE_URL);

const dashboardPages = new PageRepository(dashboardPool);
const dashboardAssets = new AssetRepository(dashboardPool);
const mcpPages = new PageRepository(mcpPool);
const mcpAssets = new AssetRepository(mcpPool);
const publicData = new PublicRepository(publicPool);
const publications = new PublicationRepository(dashboardPool, publisherPool);
const mcp = createMcpRequestHandler(mcpPages, mcpAssets, storage);

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
  if (error instanceof z.ZodError) return json({ error: "validation_error", issues: error.issues }, 422);
  if (error instanceof Error && "code" in error) {
    const code = String((error as Error & { code: unknown }).code);
    if (code === "23505") return problem("A unique value is already in use", 409, "conflict");
    if (code === "42501") return problem("Operation denied by the database security policy", 403, "forbidden");
  }
  console.error("request_failed", error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
  return problem("Internal server error", 500, "internal_error");
}

async function pageResolvers(privateMode: boolean) {
  return {
    page: async (id: string) => {
      if (privateMode) {
        const page = await dashboardPages.get(id);
        return page ? { available: true as const, href: `/app/pages/${id}` } : { available: false as const };
      }
      const page = await publicData.pageById(id);
      return page ? { available: true as const, href: `/p/${page.public_slug}` } : { available: false as const };
    },
    asset: async (id: string) => {
      if (privateMode) {
        const asset = await dashboardAssets.get(id);
        return asset ? { available: true as const, href: `/api/dashboard/assets/${id}/content` } : { available: false as const };
      }
      const asset = await publicData.asset(id);
      return asset ? { available: true as const, href: `${config.ASSET_ORIGIN}/${id}` } : { available: false as const };
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

const assetUploadSchema = z.object({
  filename: z.string().trim().min(1).max(1024),
  content_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().min(0).max(5_000_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional(),
}).strict();

export const app = new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/api/health", () => json({ status: "ok", version: "0.1.3" }))
  .all("/api/auth/*", async ({ request }) => {
    const boundary = await authorizePasskeyAuthRequest(request);
    if (boundary.denied) return boundary.denied;
    try {
      const pathname = new URL(request.url).pathname;
      const principal = await dashboardPrincipal(request);
      const response = await requireAuthenticationUserVerification(pathname, await auth.handler(request));
      if (response.ok) {
        const eventType = pathname.endsWith("/passkey/verify-registration")
          ? "passkey_registered"
          : pathname.endsWith("/oauth2/consent")
            ? "oauth_consent_changed"
            : null;
        if (eventType) {
          await authPool.query(
            `INSERT INTO security_audit_events(event_type,actor_type,actor_id,target_type,target_id)
             VALUES ($1,'owner',$2,'user',$2)`,
            [eventType, principal?.userId ?? ownerUserId],
          );
        }
      }
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
    scopes_supported: ["kb:read", "kb:write", "assets:read"],
    bearer_methods_supported: ["header"],
    resource_name: "context-use personal knowledge base",
  }))
  .get("/.well-known/oauth-protected-resource/mcp", () => json({
    resource: config.MCP_RESOURCE,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: ["kb:read", "kb:write", "assets:read"],
    bearer_methods_supported: ["header"],
  }))
  .all("/mcp", ({ request }) => mcp(request))

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
      await authClient.query(
        `INSERT INTO security_audit_events(event_type,actor_type,actor_id,target_type,target_id)
         VALUES ('mcp_client_revoked','owner',$1,'oauth_client',$2)`,
        [principal.userId, clientId],
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
  .get("/api/dashboard/audit", async ({ request }) => {
    await ownerRequest(request);
    const [security, publication] = await Promise.all([
      authPool.query(
        `SELECT id,event_type,actor_type,actor_id,target_type,target_id,details,created_at
         FROM security_audit_events ORDER BY created_at DESC LIMIT 200`,
      ),
      dashboardPool.query(
        `SELECT id,'publication_' || action::text AS event_type,'owner' AS actor_type,
                owner_user_id AS actor_id,target_kind::text AS target_type,target_id::text,
                jsonb_build_object('version_id',version_id,'public_slug',public_slug) AS details,created_at
         FROM publication_events ORDER BY created_at DESC LIMIT 200`,
      ),
    ]);
    return json([...security.rows, ...publication.rows]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 200));
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
    const [links, html] = await Promise.all([
      dashboardPages.links(page.id),
      renderMarkdown(page.body_markdown, await pageResolvers(true)),
    ]);
    return json({ ...page, ...links, rendered_html: html });
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
  .post("/api/dashboard/pages/:id/restore", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = restorePageSchema.parse(await bodyJson(request));
    const page = await dashboardPages.restore(z.string().uuid().parse(params.id), input, { kind: "dashboard", subject: principal.userId });
    return page ? json(page) : problem("Page or version not found", 404, "not_found");
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
    const html = await renderMarkdown(version.body_markdown, await pageResolvers(false));
    const references = await Promise.all([
      ...extractPageLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardPages.get(id);
        return { kind: "page" as const, id, label: target?.title ?? "Missing page", path: target?.current_path ?? null, public: Boolean(target?.published_version_id) };
      }),
      ...extractAssetLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardAssets.get(id);
        return { kind: "asset" as const, id, label: target?.filename ?? "Missing asset", path: null, public: Boolean(target?.published_at) };
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
      filename: input.filename,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
      contentHash: input.sha256,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
    });
    const upload = await storage.createUpload({
      id: created.id,
      objectKey: created.objectKey,
      filename: created.filename,
      contentType: created.content_type,
      sizeBytes: Number(created.size_bytes),
      contentHash: created.content_hash,
    });
    const { objectKey: _hidden, ...asset } = created;
    return json({ asset, upload }, 201);
  })
  .put("/api/dashboard/assets/:id/content", async ({ request, params }) => {
    const principal = await ownerRequest(request);
    if (request.headers.get("origin") !== config.APP_ORIGIN
      || request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.get("x-csrf-token") !== csrfToken(principal)) {
      throw new SecurityError("Upload authorization failed", 403);
    }
    if (!storage.writeLocal) return problem("Direct application uploads are disabled", 405, "method_not_allowed");
    const asset = await dashboardAssets.get(z.string().uuid().parse(params.id), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== Number(asset.size_bytes)) return problem("Asset size mismatch", 422, "integrity_error");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== asset.content_hash) return problem("Asset checksum mismatch", 422, "integrity_error");
    await storage.writeLocal(asset.s3_object_key, new Request(request.url, { method: "PUT", body: bytes }));
    return json({ uploaded: true });
  })
  .get("/api/dashboard/assets/:id/content", async ({ request, params }) => {
    await ownerRequest(request);
    const asset = await dashboardAssets.get(z.string().uuid().parse(params.id), true);
    if (!asset) return problem("Asset not found", 404, "not_found");
    if (storage.localFile) {
      const file = storage.localFile(asset.s3_object_key);
      if (!(await file.exists())) return problem("Asset bytes not found", 404, "not_found");
      return new Response(file, { headers: { ...securityHeaders, "content-type": asset.content_type } });
    }
    const location = await storage.createDownload({
      objectKey: asset.s3_object_key,
      filename: asset.filename,
      contentType: asset.content_type,
    }, mayRenderInline(asset.content_type));
    return new Response(null, { status: 302, headers: { ...securityHeaders, location } });
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
    const content = await renderMarkdown(page.body_markdown, await pageResolvers(false));
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
  .get("/:assetId", async ({ request, params }) => {
    if (new URL(request.url).origin !== config.ASSET_ORIGIN) return new Response("Not found", { status: 404, headers: securityHeaders });
    const assetId = z.string().uuid().safeParse(params.assetId);
    if (!assetId.success) return new Response("Not found", { status: 404, headers: securityHeaders });
    const asset = await publicData.asset(assetId.data);
    if (!asset) return new Response("Not found", { status: 404, headers: securityHeaders });
    const inline = mayRenderInline(asset.content_type);
    return new Response(await storage.read(asset.s3_object_key), {
      headers: {
        ...securityHeaders,
        "content-type": asset.content_type,
        "content-length": String(asset.size_bytes),
        "content-disposition": contentDisposition(asset.filename, inline),
      },
    });
  });

if (production) {
  console.info("security_mode", {
    dashboard_auth: "cookie-only",
    mcp_auth: "bearer-only",
    publication: "webauthn-required",
  });
}
