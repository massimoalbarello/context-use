import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  AssetRepository,
  DirectoryRepository,
  KnowledgeArchiveRepository,
  KnowledgeExportRepository,
  KnowledgeResetRepository,
  type KnowledgeExportAsset,
  type KnowledgeExportKind,
  type KnowledgeExportSnapshot,
  type RestorableKnowledgeAsset,
  type RestorableKnowledgeRecords,
  PageRepository,
  PageDeletionRepository,
  PublicationRepository,
  createPool,
  extractAssetLinks,
  extractDirectoryLinks,
  extractPageLinks,
  extractWikiLinks,
  knowledgeTemplateBaseline,
  reconcileKnowledgeTemplate,
  wikiLinkCandidatePaths,
} from "@context-use/database";
import {
  assetUploadSchema,
  archivePageSchema,
  createDirectorySchema,
  createPageSchema,
  deleteDirectorySchema,
  publicationIntentSchema,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import { authorizeDashboardRequest } from "./auth-client.ts";
import { forwardDashboardAuthRoute } from "./auth-dashboard-gateway.ts";
import { assetContentResponse } from "./asset-content.ts";
import { config, production } from "./config.ts";
import {
  claimConfirmedExport,
  completeConfirmedExportDownload,
  issueConfirmationOptions,
} from "./confirmation-client.ts";
import { dashboardServices } from "./dashboard-services.ts";
import { bodyJson, json, problem, routeError } from "./http.ts";
import { publicationWarnings, renderMarkdown } from "./markdown.ts";
import { pageDelta } from "./page-delta.ts";
import { republicationReview } from "./republication-review.ts";
import {
  SecurityError,
  requestMatchesOrigin,
  securityHeaders,
} from "./security.ts";
import { AssetIntegrityError, type GeneratedObjectMetadata } from "./storage.ts";
import { BrokeredStorage } from "./storage-client.ts";
import {
  InvalidKnowledgeArchiveError,
  readRestorableKnowledgeArchive,
  streamRestorableKnowledgeArchive,
} from "./knowledge-archive.ts";
import { streamKnowledgeExport } from "./knowledge-export.ts";
import { MAX_KNOWLEDGE_ARCHIVE_BYTES } from "./knowledge-zip.ts";
import { disableStreamingRequestIdleTimeout } from "./streaming-timeout.ts";

const dashboardPool = createPool(config.DATABASE_URL);
const storage = new BrokeredStorage({
  socketPath: config.STORAGE_SOCKET_PATH,
  token: config.STORAGE_DASHBOARD_TOKEN,
});

const dashboardPages = new PageRepository(dashboardPool);
const dashboardDirectories = new DirectoryRepository(dashboardPool);
const pageDeletions = new PageDeletionRepository(dashboardPool);
const dashboardAssets = new AssetRepository(dashboardPool);
const publications = new PublicationRepository(dashboardPool);
const knowledgeExports = new KnowledgeExportRepository(dashboardPool);
const knowledgeArchives = new KnowledgeArchiveRepository(dashboardPool);
const knowledgeResets = new KnowledgeResetRepository(dashboardPool);

class KnowledgeExportBuildError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string,
  ) {
    super(message);
  }
}

type KnowledgeExportFailure = { message: string; httpStatus: number; code: string };
type KnowledgeExportPreparation =
  | { status: "processing" }
  | ({ status: "failed" } & KnowledgeExportFailure);

const exportPreparations = new Map<string, KnowledgeExportPreparation>();

function stagedExportKey(intentId: string): string {
  return `exports/${intentId}.zip`;
}

async function ownerRequest(request: Request, mutation: boolean | "upload" = false) {
  if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
  const principal = await authorizeDashboardRequest(request, mutation === "upload" ? "upload" : mutation ? "json" : "read");
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
  return path ? `/p/${path}/` : "/p/";
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

async function unavailableExportAssets(assets: Array<Pick<KnowledgeExportAsset, "s3_object_key" | "size_bytes" | "content_hash" | "current_path">>): Promise<string[]> {
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
  ), 0)
    + snapshot.pages.reduce((total, page) => (
      total
      + Buffer.byteLength(page.title)
      + Buffer.byteLength(page.summary)
      + Buffer.byteLength(page.body_markdown)
    ), 0)
    + snapshot.assets.reduce((total, asset) => total + Number(asset.size_bytes), 0);
}

function archiveSize(records: RestorableKnowledgeRecords): number {
  return Buffer.byteLength(JSON.stringify(records))
    + records.assets.reduce((total, asset) => total + (asset.deleted_at ? 0 : Number(asset.size_bytes)), 0);
}

function exportStatusUrl(intentId: string): string {
  return `/api/dashboard/knowledge-exports/${encodeURIComponent(intentId)}/status`;
}

function exportDownloadUrl(intentId: string): string {
  return `/api/dashboard/knowledge-exports/${encodeURIComponent(intentId)}/download`;
}

function exportFilename(kind: KnowledgeExportKind): string {
  const date = new Date().toISOString().slice(0, 10);
  return kind === "restorable"
    ? `context-use-full-archive-${date}.zip`
    : `context-use-export-${date}.zip`;
}

type KnowledgeExportSource = {
  sizeBytes: number;
  assets: Array<Pick<KnowledgeExportAsset, "s3_object_key" | "size_bytes" | "content_hash" | "current_path">>;
  stream: ReadableStream<Uint8Array>;
};

async function knowledgeExportSource(exportKind: KnowledgeExportKind): Promise<KnowledgeExportSource> {
  if (exportKind === "portable") {
    const snapshot = await knowledgeExports.currentSnapshot();
    return {
      sizeBytes: exportSize(snapshot),
      assets: snapshot.assets,
      stream: streamKnowledgeExport(snapshot, storage),
    };
  }
  const snapshot = await knowledgeArchives.snapshot();
  return {
    sizeBytes: archiveSize(snapshot),
    assets: snapshot.assets.filter((asset) => !asset.deleted_at),
    stream: streamRestorableKnowledgeArchive(snapshot, storage),
  };
}

async function buildKnowledgeExport(
  intentId: string,
  exportKind: KnowledgeExportKind,
): Promise<GeneratedObjectMetadata> {
  const source = await knowledgeExportSource(exportKind);
  if (source.sizeBytes > MAX_KNOWLEDGE_ARCHIVE_BYTES) {
    throw new KnowledgeExportBuildError(
      "Knowledge changed after confirmation and the current export is now larger than 5 GiB. Remove some active assets and try again.",
      413,
      "export_too_large",
    );
  }
  const missing = await unavailableExportAssets(source.assets);
  if (missing.length) {
    const examples = missing.slice(0, 3).join(", ");
    const remaining = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
    throw new KnowledgeExportBuildError(
      `Export stopped because current knowledge includes ${missing.length} asset file${missing.length === 1 ? " that is" : "s that are"} missing or failed integrity verification: ${examples}${remaining}`,
      409,
      "asset_incomplete",
    );
  }
  return storage.writeGenerated(stagedExportKey(intentId), source.stream);
}

function startKnowledgeExportPreparation(
  intentId: string,
  exportKind: KnowledgeExportKind,
): void {
  if (exportPreparations.has(intentId)) return;
  exportPreparations.set(intentId, { status: "processing" });
  void buildKnowledgeExport(intentId, exportKind).then(() => {
    exportPreparations.delete(intentId);
  }).catch((error: unknown) => {
    const failure: KnowledgeExportFailure = error instanceof KnowledgeExportBuildError
      ? { message: error.message, httpStatus: error.httpStatus, code: error.code }
      : {
          message: "The knowledge archive could not be prepared. Start a new export and try again.",
          httpStatus: 500,
          code: "export_preparation_failed",
        };
    exportPreparations.set(intentId, { status: "failed", ...failure });
    if (!(error instanceof KnowledgeExportBuildError)) {
      console.error("knowledge_export_preparation_failed", error instanceof Error
        ? { intentId, name: error.name, message: error.message }
        : { intentId, type: typeof error });
    }
  });
}

type PreparedKnowledgeExport =
  | { status: "processing" }
  | ({ status: "failed" } & KnowledgeExportFailure)
  | { status: "ready"; staged: GeneratedObjectMetadata };

async function ensureKnowledgeExport(
  intentId: string,
  exportKind: KnowledgeExportKind,
  onStart: () => Promise<void>,
): Promise<PreparedKnowledgeExport> {
  const staged = await storage.inspectGenerated(stagedExportKey(intentId));
  if (staged) return { status: "ready", staged };
  const preparation = exportPreparations.get(intentId);
  if (preparation) return preparation;
  await onStart();
  startKnowledgeExportPreparation(intentId, exportKind);
  return { status: "processing" };
}

function processingExportResponse(intentId: string): Response {
  return json({
    status: "processing",
    status_url: exportStatusUrl(intentId),
  }, 202);
}

function readyExportBody(
  intentId: string,
  exportKind: KnowledgeExportKind,
  staged: GeneratedObjectMetadata,
) {
  return {
    status: "ready",
    download_url: exportDownloadUrl(intentId),
    filename: exportFilename(exportKind),
    size_bytes: staged.sizeBytes,
  };
}

// One intent, one status: a pending reset reports its gate alongside the
// preparation state the dashboard already polls, instead of a second endpoint.
function exportResetState(intent: {
  reset_requested: boolean;
  download_completed_at: Date | null;
  reset_completed_at: Date | null;
}) {
  if (!intent.reset_requested) return {};
  return {
    reset: {
      archive_downloaded: Boolean(intent.download_completed_at),
      cleared: Boolean(intent.reset_completed_at),
    },
  };
}

function storedImportAsset(asset: RestorableKnowledgeAsset) {
  return {
    id: asset.id,
    objectKey: asset.s3_object_key,
    filename: asset.filename,
    contentType: asset.content_type,
    sizeBytes: Number(asset.size_bytes),
    contentHash: asset.content_hash,
  };
}

// The archive stream is wrapped rather than assumed delivered: a reset may only
// proceed once the whole body has flushed to the owner's browser.
function trackedExportDownload(response: Response, onDelivered: () => void): Response {
  if (response.status !== 200 || !response.body) return response;
  const delivered = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    flush() { onDelivered(); },
  }));
  return new Response(delivered, { status: response.status, headers: response.headers });
}

const emptyObjectSchema = z.object({}).strict();
// Clearing knowledge is an export mode rather than a separate operation: it
// always produces the full restorable archive, and its one passkey
// confirmation authorizes the archive and the deletion that follows it.
const exportIntentSchema = z.object({
  kind: z.enum(["portable", "restorable"]).default("portable"),
  reset: z.boolean().default(false),
}).strict().transform((input) => input.reset ? { kind: "restorable" as const, reset: true } : input);
const templateApplySchema = z.object({
  force_template: z.boolean(),
}).strict();

const webRoot = resolve(config.WEB_DIST);
function webFile(path: string): Bun.BunFile | null {
  const resolved = resolve(webRoot, path);
  if (!resolved.startsWith(`${webRoot}/`)) return null;
  return Bun.file(resolved);
}

export const app = new Elysia({ serve: { maxRequestBodySize: 5_500_000_000 } })
  .onError(({ error, code }) => code === "NOT_FOUND"
    ? new Response("Not found", { status: 404, headers: securityHeaders })
    : routeError(error))
  .get("/api/health", () => json({ status: "ok", version: "0.1.72", service: "dashboard" }))
  .get("/api/dashboard/session", ({ request }) => forwardDashboardAuthRoute(request))
  .get("/api/dashboard/csrf", ({ request }) => forwardDashboardAuthRoute(request))
  .post("/api/dashboard/passkey-enrollment-intents", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/passkey-enrollment-intents/:id/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/passkeys/:id/removal-intents", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/passkeys/:id/remove", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/publications/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/knowledge-exports/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/knowledge-imports/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .post("/api/dashboard/page-deletions/confirm", ({ request }) => forwardDashboardAuthRoute(request), { parse: "none" })
  .get("/api/dashboard/private-mcp-clients", ({ request }) => forwardDashboardAuthRoute(request))
  .get("/api/dashboard/oauth-client-preview", ({ request }) => forwardDashboardAuthRoute(request))
  .delete("/api/dashboard/oauth-clients/:clientId", ({ request }) => forwardDashboardAuthRoute(request))

  .get("/api/dashboard/mcp-endpoint", async ({ request }) => {
    await ownerRequest(request);
    return json({
      knowledge_url: config.MCP_RESOURCE,
    });
  })
  .get("/api/dashboard/services", async ({ request }) => {
    await ownerRequest(request);
    return json({ services: dashboardServices(config) });
  })
  .get("/api/dashboard/knowledge-template/plan", async ({ request, query }) => {
    await ownerRequest(request);
    const forceTemplate = query.force_template === undefined
      ? false
      : z.enum(["true", "false"]).transform((value) => value === "true").parse(query.force_template);
    return json(await reconcileKnowledgeTemplate({
      directories: dashboardDirectories,
      pages: dashboardPages,
    }, "default", false, forceTemplate));
  })
  .post("/api/dashboard/knowledge-template/apply", async ({ request }) => {
    await ownerRequest(request, true);
    const input = templateApplySchema.parse(await bodyJson(request));
    return json(await reconcileKnowledgeTemplate({
      directories: dashboardDirectories,
      pages: dashboardPages,
    }, "default", true, input.force_template));
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
    const { kind, reset } = exportIntentSchema.parse(await bodyJson(request));
    // Read what a reset would destroy before the intent exists, so the warning
    // the owner confirms describes the knowledge the archive is about to cover.
    const knowledge = reset ? await knowledgeResets.summary() : null;
    const exportPrincipal = { ownerUserId: principal.userId, sessionId: principal.sessionId };
    const intent = await knowledgeExports.createIntent(exportPrincipal, kind, reset);
    await Promise.allSettled(intent.discarded_export_ids.map((id) => {
      exportPreparations.delete(id);
      return storage.deleteGenerated(stagedExportKey(id));
    }));
    if (intent.total_bytes > MAX_KNOWLEDGE_ARCHIVE_BYTES) {
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
        kind: intent.export_kind,
        reset: intent.reset_requested,
        page_count: intent.page_count,
        asset_count: intent.asset_count,
        total_bytes: intent.total_bytes,
      },
      knowledge,
      authentication_options: authenticationOptions,
    }, 201);
  })
  .delete("/api/dashboard/knowledge-export-intents/:id", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    await knowledgeExports.discard(z.string().uuid().parse(params.id), {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    });
    return json({ cancelled: true });
  })
  .post("/api/dashboard/knowledge-resets/:id/clear", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeExports.getIntent(intentId);
    if (!intent || !intent.reset_requested
        || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge reset intent not found", 404, "not_found");
    }
    if (!intent.confirmed_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("A fresh passkey confirmation is required", 403, "passkey_required");
    }
    if (intent.reset_completed_at) {
      return problem("This knowledge reset has already run", 409, "reset_consumed");
    }
    if (!intent.download_completed_at) {
      return problem(
        "Download the full restorable archive before the knowledge base can be cleared",
        409,
        "archive_not_downloaded",
      );
    }
    const baseline = await knowledgeTemplateBaseline("default");
    const objectKeys = await knowledgeResets.assetObjectKeys();
    const cleared = await knowledgeResets.clear(intentId, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    }, baseline);
    // Storage bytes outlive their rows deliberately: a failure here leaves
    // unreferenced objects, never a page pointing at a missing file.
    const removals = await Promise.allSettled(objectKeys.map((key) => storage.delete(key)));
    if (removals.some((removal) => removal.status === "rejected")) {
      console.warn("knowledge_reset_asset_cleanup_incomplete", { intentId });
    }
    // The deletion has already committed, so a template failure must not be
    // reported as a failed clear. Surface it as the recoverable step it is.
    try {
      const template = await reconcileKnowledgeTemplate({
        directories: dashboardDirectories,
        pages: dashboardPages,
      }, baseline.template, true, true);
      return json({ cleared, template, template_error: null });
    } catch (error) {
      console.error("knowledge_reset_template_failed", error instanceof Error
        ? { intentId, name: error.name, message: error.message }
        : { intentId, type: typeof error });
      return json({
        cleared,
        template: null,
        template_error: "The knowledge base was cleared, but the default template could not be applied. Apply it again from the knowledge template settings.",
      });
    }
  })
  .get("/api/dashboard/knowledge-import-eligibility", async ({ request }) => {
    await ownerRequest(request);
    return json({ eligible: await knowledgeArchives.importAvailable() });
  })
  .post("/api/dashboard/knowledge-import-intents", async ({ request, server }) => {
    disableStreamingRequestIdleTimeout(server, request);
    const principal = await ownerRequest(request, "upload");
    if (!await knowledgeArchives.importAvailable()) {
      return problem("Knowledge imports require a fresh Context Use instance", 409, "import_requires_fresh_instance");
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/zip")) {
      return problem("A Context Use ZIP archive is required", 415, "archive_type");
    }
    const declaredSize = Number(request.headers.get("content-length") ?? "0");
    if (declaredSize > MAX_KNOWLEDGE_ARCHIVE_BYTES + 64 * 1024 ** 2) {
      return problem("Knowledge archives are limited to 5 GiB", 413, "archive_too_large");
    }
    const intentId = randomUUID();
    const stagedAssetIds: string[] = [];
    let intentCreated = false;
    try {
      const parsed = await readRestorableKnowledgeArchive(request.body, async (asset, body) => {
        stagedAssetIds.push(asset.id);
        await storage.stageImport(intentId, storedImportAsset(asset), body);
      }, {
        // A stalled import is otherwise indistinguishable from a working one:
        // this is the only record of how far it got.
        onProgress: (staged, total) => {
          if (staged === total || staged % 25 === 0) {
            console.info("knowledge_import_staging", { intentId, staged, total });
          }
        },
      });
      const importPrincipal = { ownerUserId: principal.userId, sessionId: principal.sessionId };
      const intent = await knowledgeArchives.createImportIntent({
        id: intentId,
        principal: importPrincipal,
        archive: parsed.records,
        archiveSha256: parsed.manifest.records_sha256,
      });
      intentCreated = true;
      await Promise.allSettled(intent.discarded_imports.flatMap((discarded) => (
        discarded.archive.assets
          .filter((asset) => !asset.deleted_at)
          .map((asset) => storage.cleanupImport(discarded.id, asset.id))
      )));
      const authenticationOptions = await issueConfirmationOptions("knowledge_import", intent.id);
      return json({
        intent: { id: intent.id, expires_at: intent.expires_at },
        summary: {
          ...parsed.manifest.counts,
          active_asset_bytes: parsed.manifest.active_asset_bytes,
          created_at: parsed.manifest.created_at,
        },
        authentication_options: authenticationOptions,
      }, 201);
    } catch (error) {
      if (intentCreated) {
        await knowledgeArchives.discardImportIntent(intentId, {
          ownerUserId: principal.userId,
          sessionId: principal.sessionId,
        }).catch(() => undefined);
      }
      await Promise.allSettled(stagedAssetIds.map((assetId) => storage.cleanupImport(intentId, assetId)));
      if (error instanceof InvalidKnowledgeArchiveError) {
        return problem(error instanceof Error ? error.message : "Knowledge archive is invalid", 422, "archive_invalid");
      }
      throw error;
    }
  }, { parse: "none" })
  .post("/api/dashboard/knowledge-imports/:id/restore", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeArchives.getImportIntent(intentId);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge import intent not found", 404, "not_found");
    }
    if (!intent.confirmed_at || intent.consumed_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("A fresh passkey confirmation is required", 403, "passkey_required");
    }
    const activeAssets = intent.archive.assets.filter((asset) => !asset.deleted_at);
    let restored = false;
    try {
      const concurrency = 4;
      for (let index = 0; index < activeAssets.length; index += concurrency) {
        await Promise.all(activeAssets.slice(index, index + concurrency).map((asset) => (
          storage.promoteImport(intentId, storedImportAsset(asset))
        )));
      }
      const result = await knowledgeArchives.restoreImportIntent(intentId, {
        ownerUserId: principal.userId,
        sessionId: principal.sessionId,
      });
      restored = true;
      return json({ restored: true, counts: result });
    } finally {
      const cleanup = await Promise.allSettled(activeAssets.map((asset) => storage.cleanupImport(intentId, asset.id)));
      if (restored && cleanup.some((entry) => entry.status === "rejected")) {
        console.warn("knowledge_import_stage_cleanup_incomplete", { intentId });
      }
    }
  })
  .delete("/api/dashboard/knowledge-import-intents/:id", async ({ request, params }) => {
    const principal = await ownerRequest(request, true);
    emptyObjectSchema.parse(await bodyJson(request));
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeArchives.getImportIntent(intentId);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge import intent not found", 404, "not_found");
    }
    if (intent.confirmed_at) return problem("A confirmed knowledge import cannot be cancelled", 409, "intent_inactive");
    await knowledgeArchives.discardImportIntent(intentId, {
      ownerUserId: principal.userId,
      sessionId: principal.sessionId,
    });
    await Promise.allSettled(intent.archive.assets
      .filter((asset) => !asset.deleted_at)
      .map((asset) => storage.cleanupImport(intentId, asset.id)));
    return json({ cancelled: true });
  })
  .get("/api/dashboard/knowledge-exports/:id/status", async ({ request, params }) => {
    const principal = await ownerRequest(request);
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeExports.getIntent(intentId);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge export intent not found", 404, "not_found");
    }
    if (!intent.confirmed_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("A fresh passkey confirmation is required", 403, "passkey_required");
    }
    const reset = exportResetState(intent);
    const preparation = await ensureKnowledgeExport(
      intentId,
      intent.export_kind,
      () => claimConfirmedExport(intentId, principal),
    );
    if (preparation.status === "ready") {
      return json({ ...readyExportBody(intentId, intent.export_kind, preparation.staged), ...reset });
    }
    if (preparation.status === "failed") {
      return json({
        status: "failed",
        message: preparation.message,
        code: preparation.code,
        ...reset,
      });
    }
    return json({ status: "processing", status_url: exportStatusUrl(intentId), ...reset }, 202);
  })
  .get("/api/dashboard/knowledge-exports/:id/download", async ({ request, params, server }) => {
    disableStreamingRequestIdleTimeout(server, request);
    if (!requestMatchesOrigin(request, config.APP_ORIGIN)) throw new SecurityError("Not found", 404);
    const principal = await authorizeDashboardRequest(request, "download");
    if (!principal) throw new SecurityError("Dashboard session required", 401);
    const intentId = z.string().uuid().parse(params.id);
    const intent = await knowledgeExports.getIntent(intentId);
    if (!intent || intent.owner_user_id !== principal.userId || intent.session_id !== principal.sessionId) {
      return problem("Knowledge export intent not found", 404, "not_found");
    }
    if (!intent.confirmed_at || new Date(intent.expires_at).getTime() <= Date.now()) {
      return problem("A fresh passkey confirmation is required", 403, "passkey_required");
    }
    const objectKey = stagedExportKey(intentId);
    const preparation = await ensureKnowledgeExport(
      intentId,
      intent.export_kind,
      () => claimConfirmedExport(intentId, principal),
    );
    if (preparation.status === "failed") {
      return problem(preparation.message, preparation.httpStatus, preparation.code);
    }
    if (preparation.status === "processing") return processingExportResponse(intentId);
    await claimConfirmedExport(intentId, principal);
    const response = await assetContentResponse(request, {
      filename: exportFilename(intent.export_kind),
      content_type: "application/zip",
      size_bytes: preparation.staged.sizeBytes,
      content_hash: preparation.staged.contentHash,
    }, storage, false, objectKey);
    if (!intent.reset_requested || intent.download_completed_at) return response;
    return trackedExportDownload(response, () => {
      void completeConfirmedExportDownload(intentId, principal).catch((error: unknown) => {
        console.error("knowledge_export_download_completion_failed", error instanceof Error
          ? { intentId, name: error.name, message: error.message }
          : { intentId, type: typeof error });
      });
    });
  })
  .get("/api/dashboard/pages", async ({ request, query }) => {
    await ownerRequest(request);
    const includeArchived = query.archived === "true";
    if (typeof query.q === "string" && query.q.trim()) {
      return json(await dashboardPages.searchMetadata(query.q, { includeArchived, excludeGuides: true }));
    }
    return json(await dashboardPages.listMetadata(includeArchived, true));
  })
  .get("/api/dashboard/knowledge-changes", async ({ request, query }) => {
    await ownerRequest(request);
    const before = typeof query.before === "string"
      ? z.string().regex(/^cu-page-changes-v1\.[0-9a-z]+$/).parse(query.before)
      : undefined;
    const limit = query.limit === undefined
      ? 50
      : z.coerce.number().int().min(1).max(100).parse(query.limit);
    return json(await dashboardPages.recentChanges({
      ...(before ? { before } : {}),
      limit,
    }));
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
    return json(index);
  })
  .put("/api/dashboard/directories/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const input = updateDirectorySchema.parse(await bodyJson(request));
    const directory = await dashboardDirectories.update(z.string().uuid().parse(params.id), input);
    return directory ? json(directory) : problem("Directory not found", 404, "not_found");
  })
  .delete("/api/dashboard/directories/:id", async ({ request, params }) => {
    await ownerRequest(request, true);
    const input = deleteDirectorySchema.parse(await bodyJson(request));
    const directory = await dashboardDirectories.delete(z.string().uuid().parse(params.id), input);
    return directory ? json({ deleted: true, directory }) : problem("Directory not found", 404, "not_found");
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
    if (!page.archived_at || page.published_version_id) {
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
  .get("/api/dashboard/pages/:id/versions/:version/diff", async ({ request, params, query }) => {
    await ownerRequest(request);
    const pageId = z.string().uuid().parse(params.id);
    const versionNumber = z.coerce.number().int().positive().parse(params.version);
    const previousVersionNumber = query.from === undefined
      ? null
      : z.coerce.number().int().positive().parse(query.from);
    if (previousVersionNumber !== null && previousVersionNumber >= versionNumber) {
      return problem("The comparison version must be earlier than the selected version", 422, "invalid_comparison");
    }
    const [previous, current] = await Promise.all([
      previousVersionNumber === null
        ? Promise.resolve(null)
        : dashboardPages.version(pageId, previousVersionNumber),
      dashboardPages.version(pageId, versionNumber),
    ]);
    if (!current) return problem("Version not found", 404, "not_found");
    if (previousVersionNumber !== null && !previous) {
      return problem("Comparison version not found", 404, "not_found");
    }
    return json({
      page_id: pageId,
      comparison: {
        from_version: previousVersionNumber,
        to_version: versionNumber,
      },
      ...await pageDelta(previous, current),
    });
  })
  .get("/api/dashboard/pages/:id/publication-preview", async ({ request, params, query }) => {
    await ownerRequest(request);
    const pageId = z.string().uuid().parse(params.id);
    const page = await dashboardPages.get(pageId);
    if (!page) return problem("Page not found", 404, "not_found");
    const versionNumber = query.version ? z.coerce.number().int().positive().parse(query.version) : page.version_number;
    const version = await dashboardPages.version(pageId, versionNumber);
    if (!version) return problem("Version not found", 404, "not_found");
    const republication = await republicationReview(dashboardPages, pageId, page, version);
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
      republication,
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
