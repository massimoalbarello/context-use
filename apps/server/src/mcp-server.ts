import {
  AssetRepository,
  DocumentLinkRepository,
  DirectoryNotEmptyError,
  DirectoryRepository,
  KnowledgeSettingsRepository,
  PageRepository,
  SourceRecordRepository,
} from "@context-use/database";
import {
  archiveAssetSchema,
  archivePageSchema,
  assetUploadSchema,
  createDirectorySchema,
  createPageSchema,
  deleteDirectorySchema,
  pagePublication,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { DirectoryPath, KnowledgePath } from "@context-use/shared";
import type {
  DirectoryTree,
  DirectoryTreeNode,
  KnowledgePageMetadata,
  PagePublication,
  PagePublicationSource,
} from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.ts";
import { createAssetCapability } from "./mcp-asset-capability.ts";
import {
  createGuidanceReceipt,
  createKnowledgeGuideReceipt,
  guidanceGuidesFromReceipt,
  type GuidanceGuideVersion,
  verifyGuidanceReceipt,
  verifyKnowledgeGuideReceipt,
} from "./mcp-guidance-receipt.ts";
import type { SourceRecordReader } from "./nango-records.ts";
import { pageDelta } from "./page-delta.ts";

export type McpContext = {
  clientId: string;
  sessionId: string;
};

const SERVER_INSTRUCTIONS = "Use Context Use proactively when the user states a concrete "
  + "durable fact, decision, correction, relationship, plan, or completed activity about "
  + "their life or work, even if they do not explicitly say “remember.” Before the first "
  + "knowledge mutation in an authenticated session, call begin_knowledge_session, read its "
  + "guide, and reuse its receipt for targets without additional scoped guides. During the "
  + "guidance transition, call prepare_change for a target where scoped guides still apply.";

const MCP_BACKLINK_LIMIT = 100;

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

function markdownInline(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/([\\`*_[\]<>])/g, "\\$1");
}

type PublishedPage = Extract<PagePublication, { state: "published" }>;

/**
 * Publication state belongs in every page read, because it is the one property of a target
 * an agent cannot infer from the content it is about to change. The raw columns behind it
 * are dropped: a public path and a pinned version number answer every question they did,
 * and an id an agent cannot act on is only tokens.
 */
function withPublication<T extends PagePublicationSource>(page: T) {
  const {
    published_version_id: _publishedVersionId,
    published_version_number: _publishedVersionNumber,
    public_path: _publicPath,
    ...rest
  } = page;
  return { ...rest, publication: pagePublication(page) };
}

/** Navigation entries carry publication state without the version identity a read returns. */
function metadataWithPublication<T extends PagePublicationSource>(page: T) {
  const { current_version_id: _currentVersionId, ...rest } = withPublication(page);
  return rest;
}

function publicationMarkdown(page: PagePublicationSource): string {
  const publication = pagePublication(page);
  if (publication.state === "private") return "";
  const published = `public \`/p/${publication.public_path}\``;
  if (!publication.unpublished_changes) return ` · ${published}`;
  const version = publication.published_version_number;
  return ` · ${published} — unpublished changes since ${version ? `v${version}` : "publication"}`;
}

type PageWithPublication =
  & Omit<KnowledgePageMetadata, keyof PagePublicationSource>
  & { publication: PagePublication };

type TreeNodeWithPublication =
  & Omit<DirectoryTreeNode, "guide" | "pages" | "directories">
  & {
    guide: PageWithPublication | null;
    pages: PageWithPublication[];
    directories: TreeNodeWithPublication[];
  };

function treeWithPublication<T extends DirectoryTreeNode>(
  node: T,
): Omit<T, "guide" | "pages" | "directories"> & TreeNodeWithPublication {
  const { guide, pages, directories, ...rest } = node;
  return {
    ...rest,
    guide: guide ? metadataWithPublication(guide) : null,
    pages: pages.map(metadataWithPublication),
    directories: directories.map(treeWithPublication),
  };
}

function directoryTreeMarkdown(tree: DirectoryTree): string {
  const lines = ["# Directory browse", ""];
  const renderDirectory = (directory: DirectoryTreeNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const path = directory.path || "/";
    const summary = directory.summary ? ` — ${markdownInline(directory.summary)}` : "";
    lines.push(`${indent}- **${markdownInline(directory.title)}** \`${path}\`${summary}`);
    if (directory.guide) {
      const guideSummary = directory.guide.summary
        ? ` — ${markdownInline(directory.guide.summary)}`
        : "";
      lines.push(`${indent}  - Guide: **${markdownInline(directory.guide.title)}** \`${directory.guide.path}\` (v${directory.guide.version_number})${publicationMarkdown(directory.guide)}${guideSummary}`);
    }
    for (const page of directory.pages) {
      const pageSummary = page.summary ? ` — ${markdownInline(page.summary)}` : "";
      lines.push(`${indent}  - Page: **${markdownInline(page.title)}** \`${page.path}\` (v${page.version_number})${publicationMarkdown(page)}${pageSummary}`);
    }
    for (const child of directory.directories) renderDirectory(child, depth + 1);
    if (directory.directories_omitted) {
      const noun = directory.directories_omitted === 1 ? "directory" : "directories";
      lines.push(`${indent}  - _… ${directory.directories_omitted} more ${noun} not shown_`);
    }
  };
  renderDirectory(tree, 0);
  lines.push(
    "",
    `Depth: ${tree.requested_depth} · Directory limit: ${tree.max_directories}/folder · Page limit: ${tree.max_pages} · Truncated: ${tree.truncated ? "yes" : "no"}`,
  );
  return lines.join("\n");
}

type ApplicableGuide = GuidanceGuideVersion & {
  id: string;
  body_markdown: string;
};

const guidanceReceiptSchema = z.string().min(1).max(100_000).optional().describe(
  "Transitional full-chain receipt from prepare_change. It remains required for targets with additional scoped guides until those guides are retired.",
);

const knowledgeSessionReceiptSchema = z.string().min(1).max(8_192).optional().describe(
  "Receipt from begin_knowledge_session. Reuse it in this authenticated session for targets without additional scoped guides until the global guide changes; during the transition, targets with scoped guides require prepare_change and its guidance_receipt. Never store receipts in knowledge.",
);

const mutationReceiptSchemas = {
  knowledge_session_receipt: knowledgeSessionReceiptSchema,
  guidance_receipt: guidanceReceiptSchema,
};

const knowledgeSessionOutputSchema = z.object({
  document_id: z.string().uuid(),
  revision_id: z.string().uuid(),
  revision_number: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  body_markdown: z.string(),
  knowledge_session_receipt: z.string(),
}).strict();

const preparedChangeOutputSchema = z.object({
  target_path: DirectoryPath,
  guidance_receipt: z.string(),
  guides: z.array(z.union([
    z.object({
      path: KnowledgePath,
      body_markdown: z.string(),
    }).strict(),
    z.object({
      path: KnowledgePath,
      reuse_from_previous_prepare_change: z.literal(true),
    }).strict(),
  ])).describe(
    "The complete applicable guide chain in root-to-leaf order. Read body_markdown when present. When reuse_from_previous_prepare_change is true, reuse that guide's body from the previous prepare_change associated with cached_guidance_receipt.",
  ),
  removed_guides: z.array(KnowledgePath).optional().describe(
    "Guides from cached_guidance_receipt that no longer apply and must no longer be followed.",
  ),
}).strict();

function preparedChange(
  targetPath: string,
  receipt: string,
  guides: ApplicableGuide[],
  context: McpContext,
  cachedReceipt?: string,
): z.infer<typeof preparedChangeOutputSchema> {
  const cachedGuides = cachedReceipt
    ? guidanceGuidesFromReceipt(cachedReceipt, context) ?? []
    : [];
  const cachedVersions = new Map(cachedGuides.map((guide) => [
    guide.current_path,
    guide.current_version_id,
  ]));
  const currentPaths = new Set(guides.map((guide) => guide.current_path));
  const cachedIndexes = new Set(guides.flatMap((guide, index) => (
    cachedVersions.get(guide.current_path) === guide.current_version_id ? [index] : []
  )));
  const removedGuides = cachedGuides.filter((guide) => !currentPaths.has(guide.current_path));
  return {
    target_path: targetPath,
    guidance_receipt: receipt,
    guides: guides.map((guide, index) => cachedIndexes.has(index)
      ? {
          path: guide.current_path,
          reuse_from_previous_prepare_change: true as const,
        }
      : {
          path: guide.current_path,
          body_markdown: guide.body_markdown,
        }),
    ...(removedGuides.length
      ? { removed_guides: removedGuides.map((guide) => guide.current_path) }
      : {}),
  };
}

function guidanceRequired(targetPath: string, retryTool: string) {
  const argumentsJson = JSON.stringify({ target_path: targetPath });
  return textContent([
    "KNOWLEDGE_GUIDE_REQUIRED",
    "Call begin_knowledge_session with {}, read the returned global guide, and retry with its knowledge_session_receipt when this target has no additional scoped guides.",
    `During the guidance transition, if scoped guides apply, call prepare_change with ${argumentsJson}, read the complete returned chain, and retry ${retryTool} with its guidance_receipt.`,
  ].join("\n\n"), true);
}

function hasExactGlobalGuide(
  guides: ApplicableGuide[],
  guide: { document_id: string; current_revision_id: string },
): boolean {
  return guides.some((candidate) => candidate.id === guide.document_id
    && candidate.current_version_id === guide.current_revision_id);
}

function globalGuideUnavailable() {
  return textContent([
    "KNOWLEDGE_GUIDE_UNAVAILABLE",
    "The configured global guide and its exact current revision are not present in the applicable guide chain, so no transitional mutation receipt was issued.",
  ].join("\n\n"), true);
}

/**
 * A write aimed at a page the owner has published.
 *
 * Publication pins one immutable version, so this edit would not reach the public page at
 * all. It would wait in the page's private history and become public inside whatever the
 * owner republishes next, which is exactly how content nobody chose to publish ends up
 * public. Detail the owner did not ask to expose belongs on a private page instead.
 */
function publishedPageEdit(path: string, publication: PublishedPage) {
  const publishedVersion = publication.published_version_number;
  return textContent([
    "PUBLISHED_PAGE",
    `${path} is published at /p/${publication.public_path}, so nothing was changed. The tool is working and this is not a permission or guidance problem.`,
    `The public page keeps serving ${publishedVersion ? `published v${publishedVersion}` : "its published version"} until the owner republishes it. This edit would not appear there; it would wait in private history and become public as part of that next republication.`,
    "Prefer a private page. Put the new detail on its own page, and link it from the published page only once the owner has published it too: a link from a published page to a private one reaches no public reader.",
    "Retry update_page with acknowledge_published_page: true only when the owner asked for this published page itself to change.",
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
    `Read ${target} with read_page, copy current id and version from that response exactly, and retry ${retryTool}.`,
    "A uuid that is one character short or one character different is the usual cause.",
  ].join("\n\n"), true);
}

/**
 * An upload aimed at the folder that holds the asset rather than at the asset. Nothing rejects
 * this in the schema, and asset paths are unique only among assets, so the upload would
 * otherwise succeed at the wrong path and collide with the next asset placed in that folder.
 */
function assetPathIsDirectory(path: string) {
  return textContent([
    "ASSET_PATH_IS_A_DIRECTORY",
    `${path} is a directory, and an asset path names the asset itself rather than the folder holding it. Nothing was uploaded.`,
    `Retry create_asset_upload with a final segment naming this asset inside that folder, such as ${path}/<asset-name>.`,
  ].join("\n\n"), true);
}

export async function createMcpServer(
  context: McpContext,
  pages: PageRepository,
  directories: DirectoryRepository,
  assets: AssetRepository,
  sourceRecords: SourceRecordReader | undefined,
  recordDocuments: SourceRecordRepository | undefined,
  knowledgeSettings: KnowledgeSettingsRepository,
  documentLinks?: DocumentLinkRepository,
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
  const server = new McpServer(
    { name: "context-use", version: "0.1.75" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const actor = { kind: "mcp" as const, subject: context.clientId };

  async function hypermedia(
    documentId: string,
    revisionId: string | null,
  ) {
    if (!documentLinks) {
      return {
        links_indexed: revisionId === null,
        outbound_document_ids: [],
        backlinks: [],
        backlinks_has_more: false,
        backlinks_complete: false,
      };
    }
    const [index, backlinkPage, backlinksComplete] = await Promise.all([
      revisionId ? documentLinks.revisionIndex(revisionId) : Promise.resolve(null),
      documentLinks.backlinks(documentId, MCP_BACKLINK_LIMIT),
      documentLinks.backlinksComplete(),
    ]);
    return {
      links_indexed: revisionId === null || index?.links_indexed_at != null,
      outbound_document_ids: index?.links_indexed_at == null
        ? []
        : index.target_document_ids,
      backlinks: backlinkPage.backlinks.map((backlink) => ({
        source_document_id: backlink.source_document_id,
        source_revision_id: backlink.source_revision_id,
        source_revision_number: backlink.source_revision_number,
        source_authority: backlink.source_authority,
        source_representation: backlink.source_representation,
      })),
      backlinks_has_more: backlinkPage.has_more,
      backlinks_complete: backlinksComplete,
    };
  }

  async function hasCurrentGuidance(
    targetPath: string,
    knowledgeSessionReceipt?: string,
    guidanceReceipt?: string,
  ): Promise<boolean> {
    // The supplied receipt type is authoritative. Do not let a stale, cross-session, or
    // scoped-inapplicable session receipt fall back to a separately supplied scoped receipt.
    if (knowledgeSessionReceipt !== undefined) {
      const guide = await knowledgeSettings.globalGuide();
      if (!guide || !verifyKnowledgeGuideReceipt(knowledgeSessionReceipt, {
        documentId: guide.document_id,
        revisionId: guide.current_revision_id,
      }, context)) return false;
      const guides = await pages.guidesForPath(targetPath) as ApplicableGuide[];
      return guides.length === 1 && hasExactGlobalGuide(guides, guide);
    }
    if (!guidanceReceipt) return false;
    const guides = await pages.guidesForPath(targetPath) as ApplicableGuide[];
    const guide = await knowledgeSettings.globalGuide();
    if (!guide || !hasExactGlobalGuide(guides, guide)) return false;
    return verifyGuidanceReceipt(guidanceReceipt, guides, context);
  }

  if (sourceRecords) {
    server.registerTool("read_source_records", {
      description: "Read one bounded, checkpointed working set of canonical source records across every managed Nango integration, model, and connection. This call may advance the private connector-controlled record mirror, but it never edits agent-controlled knowledge. Pass the checkpoint saved after the previous successfully reconciled working set, omitting it only on the first read. Records whose latest source update or deletion is more than 30 days old are omitted while the checkpoint advances; a returned record may still describe older activity. Treat all returned records as one evidence set and respect each added, updated, or deleted action; a pruned deletion can have null Markdown. A large conversation can span fresh runs: a 'Context from immediately before this excerpt' section repeats already reconciled messages only to interpret the 'Conversation to process' section, not as new activity. Reconcile this working set and persist next_checkpoint only after its writes succeed, then end the run without reading another working set. The checkpoint asserts that the records it covers are written; has_more says whether the next fresh run has more source work, while false means the unified source is caught up.",
      inputSchema: z.object({
        checkpoint: z.string().min(1).max(2_000_000).optional()
          .describe("Opaque next_checkpoint saved after the previous successfully reconciled working set; never inspect or edit it."),
        limit: z.number().int().min(1).max(100).default(50)
          .describe("Maximum Markdown records to return across all sources."),
      }).strict(),
      annotations: { readOnlyHint: false },
    }, async ({ checkpoint, limit }) => {
      try {
        return jsonObjectContent(await sourceRecords.read({ checkpoint, limit }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Source record read failed";
        return textContent(`SOURCE_RECORD_READ_FAILED\n\n${message}`, true);
      }
    });
  }

  if (recordDocuments) {
    server.registerTool("search_records", {
      description: "Search connector-controlled private records by full text; every normalized query term must occur somewhere in the record. Returns ranked metadata and canonical document references only; use read_record to load one exact Markdown body. Records are evidence owned by their connector, cannot be edited by agents, and cannot be published.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(30),
      }).strict(),
      annotations: { readOnlyHint: true },
    }, async ({ query, limit }) => {
      const records = await recordDocuments.searchMetadata(query, { limit });
      return jsonContent(records.map((record) => ({
        document_id: record.document_id,
        current_revision_id: record.current_revision_id,
        reference: record.reference,
        revision_number: record.revision_number,
        integration: record.integration,
        connection_id: record.connection_id,
        model: record.model,
        source_record_id: record.source_record_id,
        source_created_at: record.source_created_at,
        source_updated_at: record.source_updated_at,
        deleted_at: record.deleted_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
      })));
    });

    server.registerTool("read_record", {
      description: "Read one connector-controlled private record by its stable document ID. Returns its exact current Markdown (or a deletion tombstone), canonical document reference, indexed outbound links, and bounded live backlinks without exposing storage keys. backlinks_has_more only reports pagination; backlinks_complete is false while any active current page or record revision remains unindexed, so undiscovered backlinks may still exist. Records cannot be edited by agents or published.",
      inputSchema: z.object({ document_id: z.string().uuid() }).strict(),
      annotations: { readOnlyHint: true },
    }, async ({ document_id }) => {
      const record = await recordDocuments.get(document_id);
      if (!record) return jsonContent(null);
      return jsonContent({
        document_id: record.document_id,
        current_revision_id: record.current_revision_id,
        reference: record.reference,
        revision_number: record.revision_number,
        integration: record.integration,
        connection_id: record.connection_id,
        model: record.model,
        source_record_id: record.source_record_id,
        source_created_at: record.source_created_at,
        source_updated_at: record.source_updated_at,
        deleted_at: record.deleted_at,
        created_at: record.created_at,
        updated_at: record.updated_at,
        body_markdown: record.body_markdown,
        hypermedia: await hypermedia(record.document_id, record.current_revision_id),
      });
    });
  }

  server.registerTool("read_directory", {
    description: "Read one directory's metadata and generated index of immediate child directories and active pages, plus the assets whose own paths sit directly inside it. Use browse_directory for a recursive subtree. The empty path reads the root.",
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
      guide: directory.guide ? metadataWithPublication(directory.guide) : null,
      // A directory has no publication of its own; its index is generated from whichever
      // descendants the owner published.
      children: directory.children.map((child) => {
        const entry = metadataWithPublication(child);
        if (child.kind === "page") return entry;
        const { publication: _publication, ...directoryEntry } = entry;
        return directoryEntry;
      }),
      reference: `context-use://directory/${directory.id}`,
    } : null);
  });

  server.registerTool("browse_directory", {
    description: "Explore a bounded directory subtree recursively without loading page bodies. Returns compact Markdown by default; request JSON only when programmatic structure is useful. Includes directory, page, and applicable AGENTS.md metadata; use read_page for selected bodies. Depth 0 includes only the starting directory's pages. Child directories are limited independently in every expanded directory, with the number of additional immediate children reported at each truncated folder.",
    inputSchema: z.object({
      path: DirectoryPath,
      depth: z.number().int().min(0).max(5).default(2),
      max_pages: z.number().int().min(1).max(500).default(200),
      max_directories: z.number().int().min(1).max(100).default(10)
        .describe("Maximum immediate child directories returned in each expanded directory."),
      format: z.enum(["markdown", "json"]).default("markdown")
        .describe("Response representation. Markdown is compact and agent-friendly; JSON preserves the full structured fields."),
    }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ path, depth, max_pages, max_directories, format }) => {
    const tree = await directories.treeByPath(path, depth, max_pages, max_directories);
    if (format === "json") return jsonContent(tree ? treeWithPublication(tree) : null);
    return textContent(tree ? directoryTreeMarkdown(tree) : "Directory not found.");
  });

  server.registerTool("create_directory", {
    description: "Create a new knowledge directory at an unused path. Its title and summary appear in the parent index; put content in child pages. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted.",
    inputSchema: createDirectorySchema.extend(mutationReceiptSchemas).strict(),
    annotations: { destructiveHint: false },
  }, async ({ knowledge_session_receipt, guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, knowledge_session_receipt, guidance_receipt)) {
      return guidanceRequired(input.path, "create_directory");
    }
    return jsonContent(await directories.create(input));
  });

  server.registerTool("update_directory", {
    description: "Update one directory's title and summary using optimistic concurrency. Read it first with read_directory. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted.",
    inputSchema: updateDirectorySchema.extend({
      directory_id: z.string().uuid(),
      ...mutationReceiptSchemas,
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ directory_id, knowledge_session_receipt, guidance_receipt, ...input }) => {
    const directory = await directories.get(directory_id);
    if (!directory) return jsonContent(null);
    if (!await hasCurrentGuidance(
      directory.current_path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(directory.current_path, "update_directory");
    }
    return jsonContent(await directories.update(directory_id, input));
  });

  server.registerTool("delete_directory", {
    description: "Permanently delete one exact non-root directory only when completely empty; this never cascades. Read it first with read_directory. Requires optimistic concurrency and a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted.",
    inputSchema: deleteDirectorySchema.extend({
      directory_id: z.string().uuid(),
      ...mutationReceiptSchemas,
    }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ directory_id, knowledge_session_receipt, guidance_receipt, ...input }) => {
    const directory = await directories.get(directory_id);
    if (!directory) return jsonContent(null);
    if (!await hasCurrentGuidance(
      directory.current_path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(directory.current_path, "delete_directory");
    }
    try {
      return jsonContent(await directories.delete(directory_id, input));
    } catch (error) {
      if (error instanceof DirectoryNotEmptyError) return textContent(error.message, true);
      throw error;
    }
  });

  server.registerTool("read_page", {
    description: "Read one current active knowledge page by semantic path or stable document UUID. Use search_pages when the target is not yet known. The hypermedia block exposes indexed outbound document IDs and bounded live backlinks. links_indexed false means this current body still needs indexing; backlinks_has_more only reports pagination; backlinks_complete false means an active current page or record revision remains unindexed, so undiscovered backlinks may still exist. The publication block reports whether the owner published this page, at which public path and version, and whether later private revisions are waiting behind that publication.",
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
    const page = page_id ? await pages.get(page_id) : await pages.getByPath(path!);
    return jsonContent(page ? {
      ...withPublication(page),
      hypermedia: await hypermedia(page.id, page.current_version_id),
    } : null);
  });

  server.registerTool("begin_knowledge_session", {
    description: "Call once before the first knowledge mutation in each authenticated MCP session. Read the exact current global hypermedia-maintenance guide returned here, then reuse its knowledge_session_receipt across stateless calls for targets without additional scoped guides. During the guidance transition, a target with scoped guides requires prepare_change and its full-chain guidance_receipt. Call again only after context loss, a new authenticated session, or a stale-receipt response. Never store receipts in knowledge.",
    inputSchema: z.object({}).strict(),
    outputSchema: knowledgeSessionOutputSchema,
    annotations: { readOnlyHint: true },
  }, async () => {
    const metadata = await knowledgeSettings.globalGuide();
    if (!metadata) {
      return textContent([
        "KNOWLEDGE_GUIDE_UNAVAILABLE",
        "The workspace has no active global knowledge-maintenance guide, so mutations are disabled.",
      ].join("\n\n"), true);
    }
    const version = await pages.version(metadata.document_id, metadata.revision_number);
    if (!version || version.id !== metadata.current_revision_id) {
      return textContent([
        "KNOWLEDGE_GUIDE_UNAVAILABLE",
        "The configured global guide revision could not be loaded exactly, so mutations are disabled.",
      ].join("\n\n"), true);
    }
    return jsonObjectContent({
      document_id: metadata.document_id,
      revision_id: metadata.current_revision_id,
      revision_number: metadata.revision_number,
      title: metadata.title,
      summary: metadata.summary,
      body_markdown: version.body_markdown,
      knowledge_session_receipt: createKnowledgeGuideReceipt({
        documentId: metadata.document_id,
        revisionId: metadata.current_revision_id,
      }, context),
    });
  });

  server.registerTool("prepare_change", {
    description: "Transitional path-scoped guidance entry point for targets where scoped AGENTS.md guides still apply and for deployed automation instructions. It returns the complete applicable chain in root-to-leaf order and a session-bound guidance_receipt only when that chain contains the exact configured global guide revision. With cached_guidance_receipt, unchanged entries explicitly say to reuse their bodies from the previous prepare_change in this authenticated session; omit it to reload every guide after context loss or compaction. Never store receipts in knowledge.",
    inputSchema: z.object({
      target_path: DirectoryPath,
      cached_guidance_receipt: z.string().min(1).max(100_000).optional()
        .describe("A receipt from a previous prepare_change whose guide bodies remain in context. Omit it to reload every applicable guide body."),
    }).strict(),
    outputSchema: preparedChangeOutputSchema,
    annotations: { readOnlyHint: true },
  }, async ({ target_path, cached_guidance_receipt }) => {
    const guides = await pages.guidesForPath(target_path) as ApplicableGuide[];
    const guide = await knowledgeSettings.globalGuide();
    if (!guide || !hasExactGlobalGuide(guides, guide)) return globalGuideUnavailable();
    return jsonObjectContent(preparedChange(
      target_path,
      createGuidanceReceipt(guides, context),
      guides,
      context,
      cached_guidance_receipt,
    ));
  });

  server.registerTool("read_skill", {
    description: `Read the complete current SKILL.md page for a relevant reusable skill.\n\n${skillCatalog}`,
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
    description: "Search current knowledge pages by full text. Returns ranked metadata only; use read_page to load a selected body.",
    inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).default(30) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    const results = await pages.searchMetadata(query, { limit });
    return jsonContent(results.map(withPublication));
  });

  server.registerTool("list_page_changes", {
    description: "List page changes after an opaque cursor for incremental processing. Rows contain metadata, not bodies or diffs, and collapse repeated edits within the fixed scan window. Compare a row with compare_page_versions. Omit cursor only on the first run; paginate with next_page_token and persist next_cursor only after the complete window succeeds.",
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

  server.registerTool("compare_page_versions", {
    description: "Compare the immutable versions named by a list_page_changes row. Returns changed metadata and compact before/after Markdown fragments while omitting unchanged body content. A pruned baseline sets comparison.complete to false; an unavailable end version returns an error. Use read_page only when a fragment needs current context.",
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

  server.registerTool("list_page_versions", {
    description: "List one page's immutable versions and commit attribution.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    return jsonContent(await pages.history(page_id));
  });

  server.registerTool("read_page_version", {
    description: "Read one exact immutable page version.",
    inputSchema: z.object({ page_id: z.string().uuid(), version_number: z.number().int().positive() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id, version_number }) => {
    return jsonContent(await pages.version(page_id, version_number));
  });

  server.registerTool("create_page", {
    description: "Create a new private Markdown knowledge page at an unused path. Use update_page when the page already exists. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted. The input schema defines summaries and supported Markdown asset layouts.",
    inputSchema: createPageSchema.extend(mutationReceiptSchemas).strict(),
    annotations: { destructiveHint: false },
  }, async ({ knowledge_session_receipt, guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, knowledge_session_receipt, guidance_receipt)) {
      return guidanceRequired(input.path, "create_page");
    }
    return jsonContent(withPublication(await pages.create(input, actor)));
  });

  server.registerTool("update_page", {
    description: "Replace or move an existing Markdown knowledge page by creating a new immutable version. Read it first with read_page and pass its current version for optimistic concurrency. The same knowledge_session_receipt from begin_knowledge_session or full-chain guidance_receipt from prepare_change must authorize both its existing and requested paths; moves across different scoped guide chains are rejected during the guidance transition. A page whose publication state is published is owner-curated: editing it does not change the public page, which keeps serving its published version until the owner republishes, so write new detail to a private page instead.",
    inputSchema: updatePageSchema.extend({
      page_id: z.string().uuid(),
      ...mutationReceiptSchemas,
      acknowledge_published_page: z.literal(true).optional().describe(
        "Required only to edit a published page, and only when the owner asked for that page itself to change. Never set it to route new detail into a published page.",
      ),
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({
    page_id,
    knowledge_session_receipt,
    guidance_receipt,
    acknowledge_published_page,
    ...input
  }) => {
    const existing = await pages.get(page_id);
    if (!existing) return unknownPage(page_id, "update_page", input.path);
    if (!await hasCurrentGuidance(
      existing.current_path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(existing.current_path, "update_page");
    }
    if (input.path !== existing.current_path && !await hasCurrentGuidance(
      input.path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(input.path, "update_page");
    }
    const publication = pagePublication(existing);
    if (publication.state === "published" && !acknowledge_published_page) {
      return publishedPageEdit(existing.current_path, publication);
    }
    const updated = await pages.update(page_id, input, actor);
    if (!updated) return unknownPage(page_id, "update_page", input.path);
    return jsonContent(withPublication(updated));
  });

  server.registerTool("archive_page", {
    description: "Archive one unpublished knowledge page using optimistic concurrency. Read it first with read_page; published pages must be manually unpublished. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted.",
    inputSchema: archivePageSchema.extend({
      page_id: z.string().uuid(),
      ...mutationReceiptSchemas,
    }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ page_id, knowledge_session_receipt, guidance_receipt, ...input }) => {
    const page = await pages.get(page_id);
    if (!page) return unknownPage(page_id, "archive_page");
    if (!await hasCurrentGuidance(
      page.current_path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(page.current_path, "archive_page");
    }
    const archived = await pages.archive(page_id, input, actor);
    if (!archived) return unknownPage(page_id, "archive_page", page.current_path);
    return jsonContent(withPublication(archived));
  });

  server.registerTool("list_assets", {
    description: "List private asset metadata and organizational paths. Does not reveal S3 keys.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    return jsonContent(await assets.list());
  });

  server.registerTool("read_asset", {
    description: "Read one private asset's metadata and a five-minute download request. Send every returned header to the exact URL before expires_at.",
    inputSchema: z.object({ asset_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ asset_id }) => {
    const asset = await assets.get(asset_id, true);
    if (!asset) return jsonContent(null);
    const capability = createAssetCapability("download", asset.id, context);
    const { s3_object_key: _hidden, ...metadata } = asset;
    return jsonContent({
      ...metadata,
      reference: `context-use://document/${asset.id}`,
      hypermedia: await hypermedia(asset.id, null),
      download: {
        method: "GET",
        url: `${config.APP_ORIGIN}/api/mcp/assets/${encodeURIComponent(asset.id)}/content`,
        headers: { "x-context-use-download-token": capability.token },
        expires_at: capability.expiresAt,
      },
    });
  });

  server.registerTool("create_asset_upload", {
    description: "Create a checksum-bound private asset upload at a path naming the asset itself, not the folder holding it. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted. PUT the exact raw bytes to the returned URL with every returned header before expires_at; image results include ready-to-paste page Markdown.",
    inputSchema: assetUploadSchema.extend(mutationReceiptSchemas).strict(),
    annotations: { destructiveHint: false },
  }, async ({ knowledge_session_receipt, guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, knowledge_session_receipt, guidance_receipt)) {
      return guidanceRequired(input.path, "create_asset_upload");
    }
    if (await directories.getByPath(input.path)) return assetPathIsDirectory(input.path);
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
    const reference = `context-use://document/${created.id}`;
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
    description: "Archive one private asset while retaining its immutable stored bytes. Read it first with read_asset. Published assets and assets referenced by an active page are rejected. Requires a current knowledge_session_receipt from begin_knowledge_session; transitional guidance_receipt is also accepted.",
    inputSchema: archiveAssetSchema.extend(mutationReceiptSchemas).strict(),
    annotations: { destructiveHint: true },
  }, async ({ asset_id, knowledge_session_receipt, guidance_receipt }) => {
    const asset = await assets.get(asset_id);
    if (!asset) return jsonContent(null);
    if (!await hasCurrentGuidance(
      asset.current_path,
      knowledge_session_receipt,
      guidance_receipt,
    )) {
      return guidanceRequired(asset.current_path, "archive_asset");
    }
    return jsonContent(await assets.archive(asset_id));
  });

  return server;
}
