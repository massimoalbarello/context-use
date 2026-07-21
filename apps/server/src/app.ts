import { resolve } from "node:path";
import {
  AssetRepository,
  AutomationRepository,
  DirectoryRepository,
  KnowledgeExportRepository,
  type KnowledgeExportAsset,
  type KnowledgeExportSnapshot,
  PageRepository,
  PageDeletionRepository,
  PublicationRepository,
  createPool,
  extractAssetLinks,
  extractDirectoryLinks,
  extractPageLinks,
  extractWikiLinks,
  wikiLinkCandidatePaths,
} from "@context-use/database";
import {
  assetUploadSchema,
  archivePageSchema,
  createCronScheduleSchema,
  createDirectorySchema,
  createPageSchema,
  publicationIntentSchema,
  updateCronScheduleSchema,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import { authorizeDashboardRequest } from "./auth-client.ts";
import { forwardDashboardAuthRoute } from "./auth-dashboard-gateway.ts";
import { decodeCompletedRunCursor, encodeCompletedRunCursor } from "./automation-run-pagination.ts";
import { assetContentResponse } from "./asset-content.ts";
import { config, production } from "./config.ts";
import { claimConfirmedExport, issueConfirmationOptions } from "./confirmation-client.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { publicationWarnings, renderMarkdown } from "./markdown.ts";
import {
  SecurityError,
  requestMatchesOrigin,
  securityHeaders,
} from "./security.ts";
import { AssetIntegrityError } from "./storage.ts";
import { BrokeredStorage } from "./storage-client.ts";
import { MAX_KNOWLEDGE_EXPORT_BYTES, streamKnowledgeExport } from "./knowledge-export.ts";

const dashboardPool = createPool(config.DATABASE_URL);
const storage = new BrokeredStorage({
  socketPath: config.STORAGE_SOCKET_PATH,
  token: config.STORAGE_DASHBOARD_TOKEN,
});

const dashboardPages = new PageRepository(dashboardPool);
const dashboardDirectories = new DirectoryRepository(dashboardPool);
const pageDeletions = new PageDeletionRepository(dashboardPool);
const dashboardAssets = new AssetRepository(dashboardPool);
const dashboardAutomations = new AutomationRepository(dashboardPool);
const publications = new PublicationRepository(dashboardPool);
const knowledgeExports = new KnowledgeExportRepository(dashboardPool);

async function ownerRequest(request: Request, mutation = false) {
  if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
  const principal = await authorizeDashboardRequest(request, mutation ? "json" : "read");
  if (!principal) throw new SecurityError("Dashboard session required", 401);
  return principal;
}

function privatePageResolvers(sourcePath: string) {
  return {
    page: async (id: string) => {
      const page = await dashboardPages.get(id);
      return page ? { available: true as const, href: `/app/pages/${id}` } : { available: false as const };
    },
    directory: async (id: string) => {
      const directory = await dashboardDirectories.get(id);
      return directory ? { available: true as const, href: `/app/directories/${id}` } : { available: false as const };
    },
    pagePath: async (path: string) => {
      for (const candidate of wikiLinkCandidatePaths(path, sourcePath)) {
        const page = await dashboardPages.getByPath(candidate);
        if (page) return { available: true as const, href: `/app/pages/${page.id}` };
        const directory = await dashboardDirectories.getByPath(candidate);
        if (directory) return { available: true as const, href: `/app/directories/${directory.id}` };
      }
      return { available: false as const };
    },
    asset: async (id: string) => {
      const asset = await dashboardAssets.get(id);
      return asset
        ? { available: true as const, href: `/api/dashboard/assets/${id}/content`, contentType: asset.content_type }
        : { available: false as const };
    },
  };
}

function isDirectoryAncestor(directoryPath: string, pagePath: string): boolean {
  return directoryPath === "" || pagePath.startsWith(`${directoryPath}/`);
}

async function directoryWillBePublic(directoryPath: string, candidatePagePath: string): Promise<boolean> {
  return isDirectoryAncestor(directoryPath, candidatePagePath)
    || dashboardDirectories.hasPublishedDescendant(directoryPath);
}

function publicDirectoryHref(path: string): string {
  return path ? `/i/${path}` : "/i";
}

// Publication previews simulate the state after the selected version becomes
// public, including self-links and generated directory indexes introduced by
// the candidate page itself.
function publishedPreviewResolvers(pageId: string, sourcePath: string) {
  return {
    page: async (id: string) => {
      if (id === pageId) return { available: true as const, href: `/p/${sourcePath}` };
      const page = await dashboardPages.get(id);
      return page?.published_version_id && page.public_path
        ? { available: true as const, href: `/p/${page.public_path}` }
        : { available: false as const };
    },
    directory: async (id: string) => {
      const directory = await dashboardDirectories.get(id);
      return directory && await directoryWillBePublic(directory.current_path, sourcePath)
        ? { available: true as const, href: publicDirectoryHref(directory.current_path) }
        : { available: false as const };
    },
    pagePath: async (path: string) => {
      for (const candidate of wikiLinkCandidatePaths(path, sourcePath)) {
        if (candidate === sourcePath) return { available: true as const, href: `/p/${sourcePath}` };
        const page = await dashboardPages.getByPath(candidate);
        if (page?.published_version_id && page.public_path) {
          return { available: true as const, href: `/p/${page.public_path}` };
        }
        const directory = await dashboardDirectories.getByPath(candidate);
        if (directory && await directoryWillBePublic(directory.current_path, sourcePath)) {
          return { available: true as const, href: publicDirectoryHref(directory.current_path) };
        }
      }
      return { available: false as const };
    },
    asset: async (id: string) => {
      const asset = await dashboardAssets.get(id, true);
      return asset?.public_path
        ? {
            available: true as const,
            href: `${config.ASSET_ORIGIN}/a/${asset.public_path}`,
            contentType: asset.content_type,
          }
        : { available: false as const };
    },
  };
}

async function unavailableExportAssets(assets: KnowledgeExportAsset[]): Promise<string[]> {
  const missing: string[] = [];
  const concurrency = 8;
  for (let index = 0; index < assets.length; index += concurrency) {
    const batch = assets.slice(index, index + concurrency);
    const verified = await Promise.all(batch.map((asset) => storage.verify(
      asset.s3_object_key,
      Number(asset.size_bytes),
      asset.content_hash,
    )));
    verified.forEach((available, offset) => {
      if (!available) missing.push(batch[offset]!.current_path);
    });
  }
  return missing;
}

function exportSize(snapshot: KnowledgeExportSnapshot): number {
  return snapshot.directories.reduce((total, directory) => (
    total
    + Buffer.byteLength(directory.title)
    + Buffer.byteLength(directory.summary)
    + Buffer.byteLength(directory.intro_markdown)
  ), 0)
    + snapshot.pages.reduce((total, page) => (
      total
      + Buffer.byteLength(page.title)
      + Buffer.byteLength(page.summary)
      + Buffer.byteLength(page.body_markdown)
    ), 0)
    + snapshot.assets.reduce((total, asset) => total + Number(asset.size_bytes), 0);
}

const emptyObjectSchema = z.object({}).strict();

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
  .get("/api/health", () => json({ status: "ok", version: "0.1.31", service: "dashboard" }))
  .get("/api/dashboard/session", ({ request }) => forwardDashboardAuthRoute(request))
  .get("/api/dashboard/csrf", ({ request }) => forwardDashboardAuthRoute(request))
  .post("/api/dashboard/publications/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/knowledge-exports/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/page-deletions/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .get("/api/dashboard/private-mcp-clients", ({ request }) => forwardDashboardAuthRoute(request))
  .get("/api/dashboard/oauth-client-preview", ({ request }) => forwardDashboardAuthRoute(request))
  .delete("/api/dashboard/oauth-clients/:clientId", ({ request }) => forwardDashboardAuthRoute(request))

  .get("/api/dashboard/mcp-endpoint", async ({ request }) => {
    await ownerRequest(request);
    return json({ url: config.MCP_RESOURCE });
  })

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

  .post("/api/dashboard/knowledge-export-intents", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    const exportPrincipal = { ownerUserId: principal.userId, sessionId: principal.sessionId };
    const intent = await knowledgeExports.createIntent(exportPrincipal);
    if (intent.total_bytes > MAX_KNOWLEDGE_EXPORT_BYTES) {
      await knowledgeExports.discard(intent.id, exportPrincipal);
      return problem(
        "Knowledge exports are limited to 5 GiB. Remove some active assets and try again.",
        413,
        "export_too_large",
      );
    }
    let missing: string[];
    try {
      missing = await unavailableExportAssets(await knowledgeExports.assets());
    } catch (error) {
      await knowledgeExports.discard(intent.id, exportPrincipal);
      throw error;
    }
    if (missing.length) {
      await knowledgeExports.discard(intent.id, exportPrincipal);
      const examples = missing.slice(0, 3).join(", ");
      const remaining = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
      return problem(
        `Export stopped because ${missing.length} asset file${missing.length === 1 ? " is" : "s are"} missing or failed integrity verification: ${examples}${remaining}`,
        409,
        "asset_incomplete",
      );
    }
    let authenticationOptions: unknown;
    try {
      authenticationOptions = await issueConfirmationOptions("knowledge_export", intent.id);
    } catch (error) {
      await knowledgeExports.discard(intent.id, exportPrincipal);
      throw error;
    }
    return json({
      intent: { id: intent.id, expires_at: intent.expires_at },
      summary: {
        page_count: intent.page_count,
        asset_count: intent.asset_count,
        total_bytes: intent.total_bytes,
      },
      authentication_options: authenticationOptions,
    }, 201);
  })
  .get("/api/dashboard/knowledge-exports/:id/download", async ({ request, params }) => {
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
    const principal = await authorizeDashboardRequest(request, "download");
    if (!principal) throw new SecurityError("Dashboard session required", 401);
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeExports.getIntent(intentId);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge export intent not found", 404, "not_found");
    }
    if (!intent.confirmed_at || intent.download_started_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("A fresh passkey confirmation is required", 403, "passkey_required");
    }
    await claimConfirmedExport(intentId, principal);
    const snapshot = await knowledgeExports.currentSnapshot();
    if (exportSize(snapshot) > MAX_KNOWLEDGE_EXPORT_BYTES) {
      return problem(
        "Knowledge changed after confirmation and the current export is now larger than 5 GiB. Remove some active assets and try again.",
        413,
        "export_too_large",
      );
    }
    const missing = await unavailableExportAssets(snapshot.assets);
    if (missing.length) {
      const examples = missing.slice(0, 3).join(", ");
      const remaining = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
      return problem(
        `Export stopped because current knowledge includes ${missing.length} asset file${missing.length === 1 ? " that is" : "s that are"} missing or failed integrity verification: ${examples}${remaining}`,
        409,
        "asset_incomplete",
      );
    }
    const date = new Date().toISOString().slice(0, 10);
    return new Response(streamKnowledgeExport(snapshot, storage), {
      headers: {
        ...securityHeaders,
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="context-use-export-${date}.zip"`,
      },
    });
  })
  .get("/api/dashboard/automations/schedules", async ({ request }) => {
    await ownerRequest(request);
    return json(await dashboardAutomations.listSchedules());
  })
  .post("/api/dashboard/automations/schedules", async ({ request }) => {
    const principal = await ownerRequest(request, true);
    const input = createCronScheduleSchema.parse(await bodyJson(request));
    return json(await dashboardAutomations.createSchedule(input, { kind: "dashboard", subject: principal.userId }), 201);
  })
  .put("/api/dashboard/automations/schedules/:id", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    const input = updateCronScheduleSchema.parse(await bodyJson(request));
    const schedule = await dashboardAutomations.updateSchedule(
      z.string().uuid().parse(params.id),
      input,
      { kind: "dashboard", subject: principal.userId },
    );
    return schedule ? json(schedule) : problem("Cron schedule not found", 404, "not_found");
  })
  .delete("/api/dashboard/automations/schedules/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const schedule = await dashboardAutomations.deleteSchedule(z.string().uuid().parse(params.id));
    return schedule ? json({ deleted: true }) : problem("Cron schedule not found", 404, "not_found");
  })
  .get("/api/dashboard/automations/runs/active", async ({ request }) => {
    await ownerRequest(request);
    return json(await dashboardAutomations.listActiveRuns());
  })
  .get("/api/dashboard/automations/runs/completed", async ({ request, query }) => {
    await ownerRequest(request);
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(query.limit);
    const encodedCursor = z.string().max(500).optional().parse(query.cursor);
    const cursor = encodedCursor ? decodeCompletedRunCursor(encodedCursor) : undefined;
    const page = await dashboardAutomations.listCompletedRuns(limit, cursor);
    return json({
      items: page.items,
      next_cursor: page.nextCursor ? encodeCompletedRunCursor(page.nextCursor) : null,
      totals: page.totals,
    });
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
  .get("/api/dashboard/directories", async ({ request, query }) => {
    await ownerRequest(request);
    return json(await dashboardDirectories.list(typeof query.q === "string" ? query.q : undefined));
  })
  .post("/api/dashboard/directories", async ({ request }) => {
    await ownerRequest(request, true);
    const input = createDirectorySchema.parse(await bodyJson(request));
    return json(await dashboardDirectories.create(input), 201);
  })
  .get("/api/dashboard/directories/:id", async ({ request, params }) => {
    await ownerRequest(request);
    const index = await dashboardDirectories.indexById(z.string().uuid().parse(params.id));
    if (!index) return problem("Directory not found", 404, "not_found");
    const html = await renderMarkdown(index.intro_markdown, privatePageResolvers(index.current_path ? `${index.current_path}/index` : "index"));
    return json({ ...index, rendered_intro_html: html });
  })
  .put("/api/dashboard/directories/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const input = updateDirectorySchema.parse(await bodyJson(request));
    const directory = await dashboardDirectories.update(z.string().uuid().parse(params.id), input);
    return directory ? json(directory) : problem("Directory not found", 404, "not_found");
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
  .post("/api/dashboard/pages/:id/deletion-intents", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    const pageId = z.string().uuid().parse(params.id);
    const page = await dashboardPages.get(pageId);
    if (!page) return problem("Page not found", 404, "not_found");
    if (!page.archived_at || page.published_version_id || page.automation_instructions) {
      return problem("Only archived, unpublished pages can be permanently deleted", 409, "page_not_deletable");
    }
    const intent = await pageDeletions.createIntent(pageId, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    });
    if (!intent) return problem("Page is no longer eligible for permanent deletion", 409, "page_not_deletable");
    const authenticationOptions = await issueConfirmationOptions("page_deletion", intent.id);
    return json({ intent, authentication_options: authenticationOptions }, 201);
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
    const html = await renderMarkdown(version.body_markdown, publishedPreviewResolvers(pageId, version.path));
    const references = await Promise.all([
      ...extractPageLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardPages.get(id);
        return {
          kind: "page" as const,
          id,
          label: id === pageId ? version.title : target?.title ?? "Missing page",
          path: id === pageId ? version.path : target?.current_path ?? null,
          public: id === pageId || Boolean(target?.published_version_id),
        };
      }),
      ...extractDirectoryLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardDirectories.get(id);
        return {
          kind: "directory" as const,
          id,
          label: target?.title ?? "Missing directory",
          path: target?.current_path ?? null,
          public: target ? await directoryWillBePublic(target.current_path, version.path) : false,
        };
      }),
      ...extractWikiLinks(version.body_markdown).map(async ({ path, label }) => {
        let target = null;
        let publishingTarget = false;
        for (const candidate of wikiLinkCandidatePaths(path, version.path)) {
          if (candidate === version.path) {
            target = page;
            publishingTarget = true;
            break;
          }
          target = await dashboardPages.getByPath(candidate);
          if (target) break;
        }
        if (!target) {
          let directory = null;
          for (const candidate of wikiLinkCandidatePaths(path, version.path)) {
            directory = await dashboardDirectories.getByPath(candidate);
            if (directory) break;
          }
          if (directory) return {
            kind: "directory" as const,
            id: directory.id,
            label: directory.title,
            path: directory.current_path,
            public: await directoryWillBePublic(directory.current_path, version.path),
          };
        }
        return {
          kind: "page" as const,
          id: target?.id ?? `path:${path}`,
          label: publishingTarget ? version.title : target?.title ?? label,
          path: publishingTarget ? version.path : target?.current_path ?? path,
          public: publishingTarget || Boolean(target?.published_version_id),
        };
      }),
      ...extractAssetLinks(version.body_markdown).map(async (id) => {
        const target = await dashboardAssets.get(id);
        return { kind: "asset" as const, id, label: target?.filename ?? "Missing asset", path: target?.current_path ?? null, public: Boolean(target?.public_path) };
      }),
    ]);
    return json({
      page_id: pageId,
      version_id: version.id,
      version_number: version.version_number,
      title: version.title,
      summary: version.summary,
      path: version.path,
      rendered_html: html,
      current_public_path: page.public_path,
      warnings: publicationWarnings(version.body_markdown, [version.title, version.summary]),
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
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
    const principal = await authorizeDashboardRequest(request, "upload");
    if (!principal) throw new SecurityError("Dashboard session required", 401);
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
      public_url: `${config.ASSET_ORIGIN}/a/${asset.public_path ?? asset.current_path}`,
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

    let publicPath: string | null = null;
    if (input.target_kind === "page") {
      const page = await dashboardPages.get(input.target_id);
      if (!page) return problem("Page not found", 404, "not_found");
      if (page.automation_instructions && input.action !== "unpublish") {
        return problem("Automation instruction pages remain private", 403, "automation_instructions_private");
      }
      if (input.action !== "unpublish") {
        if (!input.version_id) return problem("Page version is required", 422);
        const history = await dashboardPages.history(input.target_id);
        const version = history.find((candidate) => candidate.id === input.version_id);
        if (!version) return problem("Version does not belong to page", 422);
        publicPath = version.path;
      }
    } else {
      const asset = await dashboardAssets.get(input.target_id, true);
      if (!asset) return problem("Asset not found", 404, "not_found");
      if (input.action !== "unpublish" && !(await storage.verify(asset.s3_object_key, Number(asset.size_bytes), asset.content_hash))) {
        return problem("Asset upload is incomplete or failed integrity verification", 409, "asset_incomplete");
      }
      if (input.action !== "unpublish") publicPath = asset.current_path;
    }

    const intent = await publications.createIntent(input, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    }, publicPath);
    const authenticationOptions = await issueConfirmationOptions("publication", intent.id);
    return json({ intent, authentication_options: authenticationOptions }, 201);
  });

if (production) {
  console.info("security_mode", {
    dashboard_auth: "cookie-only",
    publication_confirmation: "separate-service",
  });
}
