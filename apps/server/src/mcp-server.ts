import {
  AssetRepository,
  DirectoryNotEmptyError,
  DirectoryRepository,
  PageRepository,
} from "@context-use/database";
import {
  archiveAssetSchema,
  archivePageSchema,
  assetUploadSchema,
  createDirectorySchema,
  createPageSchema,
  deleteDirectorySchema,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { DirectoryPath, KnowledgePath } from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.ts";
import { createAssetCapability } from "./mcp-asset-capability.ts";
import {
  createGuidanceReceipt,
  guidanceGuidesFromReceipt,
  type GuidanceGuideVersion,
  verifyGuidanceReceipt,
} from "./mcp-guidance-receipt.ts";
import type { SourceRecordReader } from "./nango-records.ts";
import { pageDelta } from "./page-delta.ts";

export type McpContext = {
  clientId: string;
  sessionId: string;
};

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const jsonObjectContent = (value: object) => ({
  ...jsonContent(value),
  structuredContent: value as Record<string, unknown>,
});

const textContent = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true as const } : {}),
});

type ApplicableGuide = GuidanceGuideVersion & {
  title: string;
  body_markdown: string;
};

const guidanceReceiptSchema = z.string().min(1).max(100_000).optional().describe(
  "Required for mutation. Reuse a receipt while it covers the target's current guide chain; otherwise obtain one with prepare_knowledge_write.",
);

function guideLabel(path: string): string {
  return path === "agents" ? "Root AGENTS.md" : `${path.replace(/\/agents$/, "")}/AGENTS.md`;
}

function preparedGuidance(
  targetPath: string,
  receipt: string,
  guides: ApplicableGuide[],
  cachedReceipt?: string,
): string {
  const decodedCache = cachedReceipt ? guidanceGuidesFromReceipt(cachedReceipt) : null;
  const exactLegacyCache = Boolean(cachedReceipt && !decodedCache
    && verifyGuidanceReceipt(cachedReceipt, guides));
  const cachedGuides = decodedCache ?? (exactLegacyCache ? guides : []);
  const cachedVersions = new Map(cachedGuides.map((guide) => [
    guide.current_path,
    guide.current_version_id,
  ]));
  const currentPaths = new Set(guides.map((guide) => guide.current_path));
  const cachedIndexes = new Set(guides.flatMap((guide, index) => (
    cachedVersions.get(guide.current_path) === guide.current_version_id ? [index] : []
  )));
  const replacedGuides = guides.filter((guide) => (
    cachedVersions.has(guide.current_path)
    && cachedVersions.get(guide.current_path) !== guide.current_version_id
  ));
  const removedGuides = cachedGuides.filter((guide) => !currentPaths.has(guide.current_path));
  const renderedGuides = guides.flatMap((guide, index) => cachedIndexes.has(index) ? [] : [[
    `===== BEGIN GUIDE ${index + 1}/${guides.length}: ${guideLabel(guide.current_path)} =====`,
    guide.body_markdown.trim(),
    `===== END GUIDE ${index + 1}/${guides.length}: ${guideLabel(guide.current_path)} =====`,
  ].join("\n\n")]).join("\n\n");
  const applicableGuides = guides.length
    ? guides.map((guide, index) => `- ${cachedIndexes.has(index) ? "CACHED" : "LOADED"}: ${guideLabel(guide.current_path)}`).join("\n")
    : "- None";
  const cacheStatus = !cachedReceipt
    ? "No cached receipt supplied; all applicable guide bodies are loaded below."
    : decodedCache || exactLegacyCache
      ? `Reused ${cachedIndexes.size} unchanged guide${cachedIndexes.size === 1 ? "" : "s"}; loaded ${guides.length - cachedIndexes.size} new or changed guide${guides.length - cachedIndexes.size === 1 ? "" : "s"}.`
      : "The cached receipt was invalid or could not be applied; all applicable guide bodies are loaded below.";
  return [
    `GUIDANCE_RECEIPT: ${receipt}`,
    `TARGET_PATH: ${targetPath || "<root>"}`,
    "This receipt covers the complete current guide chain. Reuse it for later mutations whose applicable guide chain is unchanged.",
    `CACHE_STATUS: ${cacheStatus}`,
    `APPLICABLE_GUIDES:\n${applicableGuides}`,
    replacedGuides.length
      ? `REPLACED_CACHED_GUIDES:\n${replacedGuides.map((guide) => `- ${guideLabel(guide.current_path)}`).join("\n")}`
      : "",
    removedGuides.length
      ? `GUIDES_NO_LONGER_APPLICABLE:\n${removedGuides.map((guide) => `- ${guideLabel(guide.current_path)}`).join("\n")}`
      : "",
    renderedGuides
      ? "The new or changed instructions below apply in root-to-leaf order. Combine them with the cached applicable guides above; more specific guides override earlier guides when they conflict."
      : "No guide bodies are repeated because every applicable guide is already cached.",
    renderedGuides,
  ].filter(Boolean).join("\n\n");
}

function guidanceRequired(targetPath: string, retryTool: string) {
  const argumentsJson = JSON.stringify({ target_path: targetPath });
  return textContent([
    "GUIDANCE_REQUIRED",
    `Call prepare_knowledge_write with ${argumentsJson}.`,
    "If you have a previously returned receipt, also pass it as cached_guidance_receipt so unchanged guides are not repeated.",
    `Then retry ${retryTool} with the returned guidance_receipt.`,
  ].join("\n\n"), true);
}

/**
 * A mutation aimed at a `page_id` nothing resolves.
 *
 * The bare `null` this used to return is indistinguishable from a broken tool, and an
 * unattended run that reads it as one stops on an unadvanced checkpoint and loses the whole
 * batch it was writing. The id is the one part of a write copied by hand from an earlier
 * read, so a wrong character in it is an ordinary mistake with an obvious repair, and the
 * response is where that repair has to be stated.
 */
function unknownPage(pageId: string, retryTool: string, path?: string) {
  const target = path ? `the page at ${path}` : "the page";
  return textContent([
    "PAGE_NOT_FOUND",
    `No page has id ${pageId}, so nothing was changed. The tool is working and this is not a permission or guidance problem.`,
    `Read ${target} with get_page, copy current id and version from that response exactly, and retry ${retryTool}.`,
    "A uuid that is one character short or one character different is the usual cause.",
  ].join("\n\n"), true);
}

export async function createMcpServer(
  context: McpContext,
  pages: PageRepository,
  directories: DirectoryRepository,
  assets: AssetRepository,
  sourceRecords?: SourceRecordReader,
): Promise<McpServer> {
  const skillPages = await pages.metadataInDirectory?.("skills") ?? [];
  const skills = skillPages
    .filter((page) => page.title === "SKILL.md" && page.path !== "skills/agents"
      && !page.path.slice("skills/".length).includes("/"))
    .map((page) => ({
      name: page.path.slice("skills/".length),
      summary: page.summary,
    }));
  const skillCatalog = skills.length
    ? `Available reusable skills:\n${skills.map((skill) => `- ${skill.name}: ${skill.summary}`).join("\n")}`
    : "Available reusable skills: none.";
  const server = new McpServer({ name: "context-use", version: "0.1.65" });
  const actor = { kind: "mcp" as const, subject: context.clientId };

  async function hasCurrentGuidance(targetPath: string, receipt?: string): Promise<boolean> {
    if (!receipt) return false;
    const guides = await pages.guidesForPath(targetPath) as ApplicableGuide[];
    return verifyGuidanceReceipt(receipt, guides);
  }

  if (sourceRecords) {
    server.registerTool("read_source_records", {
      description: "Read the next bounded, checkpointed batch of canonical source records across every managed Nango integration, model, and connection. Pass the checkpoint saved after the previous successfully reconciled batch, omitting it only on the first read. Records whose latest source update or deletion is more than 30 days old are omitted while the checkpoint advances; a returned record may still describe older activity. Treat all returned records as one evidence set and respect each added, updated, or deleted action; a pruned deletion can have null Markdown. Reconcile this batch and persist next_checkpoint before calling again when has_more is true: the checkpoint asserts that the records it covers are written, so persist it only after their writes succeed, and never hold a second unread batch while the first is unwritten. Continue until has_more is false so the next scheduled automation invocation receives only later lifecycle changes.",
      inputSchema: z.object({
        checkpoint: z.string().min(1).max(2_000_000).optional()
          .describe("Opaque next_checkpoint saved after the previous successfully reconciled batch; never inspect or edit it."),
        limit: z.number().int().min(1).max(100).default(50)
          .describe("Maximum Markdown records to return across all sources."),
      }).strict(),
      annotations: { readOnlyHint: true },
    }, async ({ checkpoint, limit }) => {
      try {
        return jsonObjectContent(await sourceRecords.read({ checkpoint, limit }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Source record read failed";
        return textContent(`SOURCE_RECORD_READ_FAILED\n\n${message}`, true);
      }
    });
  }

  server.registerTool("get_directory", {
    description: "Read a linkable directory index by path or stable UUID. Returns the directory metadata and its generated list of immediate child directories and active pages with summaries. Use the empty path for the root index.",
    inputSchema: z.object({
      path: DirectoryPath.optional(),
      directory_id: z.string().uuid().optional(),
    }).strict().superRefine((value, context) => {
      if ((value.path === undefined) === (value.directory_id === undefined)) {
        context.addIssue({ code: "custom", message: "Provide exactly one of path or directory_id" });
      }
    }),
    annotations: { readOnlyHint: true },
  }, async ({ path, directory_id }) => {
    const directory = directory_id
      ? await directories.indexById(directory_id)
      : await directories.indexByPath(path!);
    return jsonContent(directory ? {
      ...directory,
      reference: `context-use://directory/${directory.id}`,
    } : null);
  });

  server.registerTool("browse_directory", {
    description: "Explore a directory subtree hierarchically. Returns minimal directory metadata, active page metadata, and each directory's AGENTS.md metadata in a prominent guide field. Page bodies are omitted; use get_page for selected pages. Depth 0 includes only pages directly inside the starting directory.",
    inputSchema: z.object({
      path: DirectoryPath,
      depth: z.number().int().min(0).max(5).default(2),
      max_pages: z.number().int().min(1).max(500).default(200),
    }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ path, depth, max_pages }) => {
    const tree = await directories.treeByPath(path, depth, max_pages);
    return tree ? jsonObjectContent(tree) : jsonContent(null);
  });

  server.registerTool("list_directories", {
    description: "List directory metadata. Prefer get_directory for progressive exploration.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(500).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query }) => jsonContent(await directories.list(query)));

  server.registerTool("create_directory", {
    description: "Create a first-class directory beneath an existing directory. Pass a current guidance_receipt covering the new directory path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. Its title and optional summary are the metadata displayed in its parent's index; content belongs in child pages such as intro. The directory becomes immediately linkable by path or stable directory reference.",
    inputSchema: createDirectorySchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "create_directory");
    }
    return jsonContent(await directories.create(input));
  });

  server.registerTool("update_directory", {
    description: "Edit a directory's public-listing title and optional summary. These are displayed in its parent's index; content belongs in child pages such as intro. Pass a current guidance_receipt covering the directory's path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. Public child listings are generated by the framework.",
    inputSchema: updateDirectorySchema.extend({
      directory_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ directory_id, guidance_receipt, ...input }) => {
    const directory = await directories.get(directory_id);
    if (!directory) return jsonContent(null);
    if (!await hasCurrentGuidance(directory.current_path, guidance_receipt)) {
      return guidanceRequired(directory.current_path, "update_directory");
    }
    return jsonContent(await directories.update(directory_id, input));
  });

  server.registerTool("delete_directory", {
    description: "Permanently delete one exact, non-root directory only when it is completely empty. This never cascades: descendant active or archived pages, live assets, and child directories are reported and must be deleted first. First use get_directory, then pass a current guidance_receipt covering the directory's path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not.",
    inputSchema: deleteDirectorySchema.extend({
      directory_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ directory_id, guidance_receipt, ...input }) => {
    const directory = await directories.get(directory_id);
    if (!directory) return jsonContent(null);
    if (!await hasCurrentGuidance(directory.current_path, guidance_receipt)) {
      return guidanceRequired(directory.current_path, "delete_directory");
    }
    try {
      return jsonContent(await directories.delete(directory_id, input));
    } catch (error) {
      if (error instanceof DirectoryNotEmptyError) return textContent(error.message, true);
      throw error;
    }
  });

  server.registerTool("get_page", {
    description: "Get the current active version of a knowledge page by stable UUID or semantic path.",
    inputSchema: z.object({
      page_id: z.string().uuid().optional(),
      path: KnowledgePath.optional(),
    }).strict().superRefine((value, context) => {
      if ((value.page_id === undefined) === (value.path === undefined)) {
        context.addIssue({ code: "custom", message: "Provide exactly one of page_id or path" });
      }
    }),
    annotations: { readOnlyHint: true },
  }, async ({ page_id, path }) => {
    return jsonContent(page_id ? await pages.get(page_id) : await pages.getByPath(path!));
  });

  server.registerTool("prepare_knowledge_write", {
    description: "Resolve the complete current root-to-leaf AGENTS.md guide chain before creating, changing, moving, or archiving knowledge. Pass an empty target path to load the root guide alone, which is how to read the conventions before choosing where a page belongs. Returns a guidance_receipt to pass to mutations; retain it for the current task, reuse it for targets with the same guide chain, and never store one in knowledge. When moving to another scope or refreshing a rejected receipt, pass cached_guidance_receipt; unchanged guide bodies are not repeated, while changed, newly applicable, and no-longer-applicable guides are identified. Omit the cache to load every applicable guide.",
    inputSchema: z.object({
      target_path: DirectoryPath,
      cached_guidance_receipt: z.string().min(1).max(100_000).optional()
        .describe("A receipt returned earlier in this task; valid unchanged guides it contains will not be repeated."),
    }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ target_path, cached_guidance_receipt }) => {
    const guides = await pages.guidesForPath(target_path) as ApplicableGuide[];
    return textContent(preparedGuidance(
      target_path,
      createGuidanceReceipt(guides),
      guides,
      cached_guidance_receipt,
    ));
  });

  server.registerTool("load_skill", {
    description: `Load the complete current SKILL.md page for a relevant reusable skill.\n\n${skillCatalog}`,
    inputSchema: z.object({
      name: z.string().trim().min(1).max(128)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use the listed lowercase skill name"),
    }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ name }) => {
    if (name === "agents") return jsonContent(null);
    const skill = await pages.getByPath(`skills/${name}`);
    return jsonContent(skill?.title === "SKILL.md" ? skill : null);
  });

  server.registerTool("search_pages", {
    description: "Full-text search current knowledge pages. Returns metadata only; use get_page with a result's UUID or semantic path to read its body.",
    inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).default(30) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    return jsonContent(await pages.searchMetadata(query, { limit }));
  });

  server.registerTool("get_knowledge_changes", {
    description: "Read the durable, context-use-recorded page changes after the opaque cursor from the previous successful automation run. The ledger contains paths and commit metadata but never bodies or diffs. Within the fixed scan window, multiple edits to one page collapse to its latest change. Each row includes previous_version_number for the version current at the input cursor, or null when there was no prior version; pass it with page_id and version_number to get_page_delta for one compact comparison. Omit cursor only on the first run. When has_more is true, call again with next_page_token and no cursor; persist next_cursor only after every page has been processed and the run has completed successfully.",
    inputSchema: z.object({
      cursor: z.string().regex(/^cu-page-changes-v1\.[0-9a-z]+$/).optional()
        .describe("Opaque next_cursor persisted by the harness after the previous successful complete scan."),
      page_token: z.string().regex(/^cu-page-scan-v1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+$/).optional()
        .describe("Opaque next_page_token from the preceding call in this scan; omit cursor when using it."),
      limit: z.number().int().min(1).max(500).default(200)
        .describe("Maximum distinct changed pages to return in this page."),
    }).strict().superRefine((value, context) => {
      if (value.cursor && value.page_token) {
        context.addIssue({ code: "custom", message: "Provide a cursor or page_token, not both" });
      }
    }),
    annotations: { readOnlyHint: true },
  }, async ({ cursor, page_token, limit }) => {
    return jsonObjectContent(await pages.changesSince({
      ...(cursor ? { cursor } : {}),
      ...(page_token ? { pageToken: page_token } : {}),
      limit,
    }));
  });

  server.registerTool("get_page_delta", {
    description: "Compare the immutable page versions named by a get_knowledge_changes row. Returns explicit requested, actual and ending comparison versions; exact changed path, title and summary values; and separate before/after Markdown fragments for each changed part of the body. Unchanged body content is omitted. Normally the requested and actual baselines match. If the requested baseline was pruned, the oldest retained version after it and at or before the window end becomes the actual baseline and comparison.complete is false. A null previous_version_number treats the end version as newly available baseline evidence. If the end version is unavailable, the tool returns an error rather than substituting another version. Use get_page separately only when a changed fragment needs current entity context.",
    inputSchema: z.object({
      page_id: z.string().uuid(),
      previous_version_number: z.number().int().positive().nullable(),
      version_number: z.number().int().positive(),
    }).strict().superRefine((value, context) => {
      if (value.previous_version_number !== null
        && value.previous_version_number >= value.version_number) {
        context.addIssue({
          code: "custom",
          message: "previous_version_number must be less than version_number",
        });
      }
    }),
    annotations: { readOnlyHint: true },
  }, async ({ page_id, previous_version_number, version_number }) => {
    const [requestedPrevious, current] = await Promise.all([
      previous_version_number === null
        ? Promise.resolve(null)
        : pages.version(page_id, previous_version_number),
      pages.version(page_id, version_number),
    ]);
    if (!current) {
      return textContent([
        "PAGE_DELTA_UNAVAILABLE",
        `Page ${page_id} version ${version_number} is not retained; no safe comparison was produced.`,
      ].join("\n\n"), true);
    }
    const retainedPrevious = previous_version_number !== null && !requestedPrevious
      ? await pages.oldestRetainedVersionAfter(
        page_id,
        previous_version_number,
        version_number,
      ) ?? current
      : null;
    const previous = requestedPrevious ?? retainedPrevious;
    const actualFromVersion = previous_version_number === null
      ? null
      : requestedPrevious
        ? previous_version_number
        : retainedPrevious!.version_number;
    return jsonObjectContent({
      page_id,
      comparison: {
        requested_from_version: previous_version_number,
        actual_from_version: actualFromVersion,
        to_version: version_number,
        complete: actualFromVersion === previous_version_number,
      },
      ...await pageDelta(previous, current),
    });
  });

  server.registerTool("get_page_history", {
    description: "List immutable versions and commit attribution for a page.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    return jsonContent(await pages.history(page_id));
  });

  server.registerTool("get_page_version", {
    description: "Read one immutable page version.",
    inputSchema: z.object({ page_id: z.string().uuid(), version_number: z.number().int().positive() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id, version_number }) => {
    return jsonContent(await pages.version(page_id, version_number));
  });

  server.registerTool("create_page", {
    description: "Create a private Markdown page and its first immutable version beneath an existing directory. Pass a current guidance_receipt covering the intended path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: createPageSchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "create_page");
    }
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency. Pass a current guidance_receipt covering the intended path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: updatePageSchema.extend({
      page_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ page_id, guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "update_page");
    }
    const updated = await pages.update(page_id, input, actor);
    if (!updated) return unknownPage(page_id, "update_page", input.path);
    return jsonContent(updated);
  });

  server.registerTool("archive_page", {
    description: "Archive an unpublished page. Pass a current guidance_receipt covering the page's current path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. Published pages must be manually unpublished in the dashboard first.",
    inputSchema: archivePageSchema.extend({
      page_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ page_id, guidance_receipt, ...input }) => {
    const page = await pages.get(page_id);
    if (!page) return unknownPage(page_id, "archive_page");
    if (!await hasCurrentGuidance(page.current_path, guidance_receipt)) {
      return guidanceRequired(page.current_path, "archive_page");
    }
    const archived = await pages.archive(page_id, input, actor);
    if (!archived) return unknownPage(page_id, "archive_page", page.current_path);
    return jsonContent(archived);
  });

  server.registerTool("list_assets", {
    description: "List private asset metadata and organizational paths. Does not reveal S3 keys.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    return jsonContent(await assets.list());
  });

  server.registerTool("get_asset", {
    description: "Get asset metadata and a five-minute, API-proxied download request. Send every returned header to the exact URL before expires_at.",
    inputSchema: z.object({ asset_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ asset_id }) => {
    const asset = await assets.get(asset_id, true);
    if (!asset) return jsonContent(null);
    const capability = createAssetCapability("download", asset.id, context);
    const { s3_object_key: _hidden, ...metadata } = asset;
    return jsonContent({
      ...metadata,
      download: {
        method: "GET",
        url: `${config.APP_ORIGIN}/api/mcp/assets/${encodeURIComponent(asset.id)}/content`,
        headers: { "x-context-use-download-token": capability.token },
        expires_at: capability.expiresAt,
      },
    });
  });

  server.registerTool("create_asset_upload", {
    description: "Create a private, checksum-bound asset upload. Pass a current guidance_receipt covering the intended path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. PUT the exact raw bytes to the returned URL with every returned header before expires_at. Image uploads return ready-to-paste page Markdown and a safe formatting example. The upload credential cannot read, edit, delete, or publish assets.",
    inputSchema: assetUploadSchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "create_asset_upload");
    }
    const created = await assets.create({
      currentPath: input.path,
      filename: input.filename,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
      contentHash: input.sha256,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
    });
    const capability = createAssetCapability("upload", created.id, context);
    const { objectKey: _hidden, ...asset } = created;
    const reference = `context-use://asset/${created.id}`;
    const markdownAlt = created.filename.replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "Image";
    const imageMarkdown = `![${markdownAlt}](${reference})`;
    return jsonContent({
      asset,
      reference,
      ...(/^image\/(?:png|jpeg|gif|webp|avif)(?:;|$)/i.test(created.content_type)
        ? {
            page_markdown: {
              default: imageMarkdown,
              formatted_example: `${imageMarkdown}{size=medium align=center shape=auto}`,
            },
          }
        : {}),
      upload: {
        method: "PUT",
        url: `${config.APP_ORIGIN}/api/mcp/assets/${encodeURIComponent(created.id)}/content`,
        headers: {
          "content-type": created.content_type,
          "content-length": String(created.size_bytes),
          "x-context-use-upload-token": capability.token,
        },
        expires_at: capability.expiresAt,
      },
    });
  });

  server.registerTool("archive_asset", {
    description: "Archive a private asset while retaining its immutable stored bytes. First use get_asset, then pass a current guidance_receipt covering the asset's current path; reuse a cached receipt when its guide chain still applies, or call prepare_knowledge_write when it does not. Published assets and assets referenced by a current active page are rejected. This tool never deletes stored bytes.",
    inputSchema: archiveAssetSchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ asset_id, guidance_receipt }) => {
    const asset = await assets.get(asset_id);
    if (!asset) return jsonContent(null);
    if (!await hasCurrentGuidance(asset.current_path, guidance_receipt)) {
      return guidanceRequired(asset.current_path, "archive_asset");
    }
    return jsonContent(await assets.archive(asset_id));
  });

  return server;
}
