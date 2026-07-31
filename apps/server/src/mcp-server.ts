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
  type GuidanceGuideVersion,
  verifyGuidanceReceipt,
} from "./mcp-guidance-receipt.ts";

export type McpContext = {
  clientId: string;
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

const guidanceReceiptSchema = z.string().min(1).optional().describe(
  "Required for mutation. Obtain it by calling prepare_knowledge_write for the mutation target.",
);

function guideLabel(path: string): string {
  return path === "agents" ? "Root AGENTS.md" : `${path.replace(/\/agents$/, "")}/AGENTS.md`;
}

function preparedGuidance(
  targetPath: string,
  receipt: string,
  guides: ApplicableGuide[],
): string {
  const renderedGuides = guides.map((guide, index) => [
    `===== BEGIN GUIDE ${index + 1}/${guides.length}: ${guideLabel(guide.current_path)} =====`,
    guide.body_markdown.trim(),
    `===== END GUIDE ${index + 1}/${guides.length}: ${guideLabel(guide.current_path)} =====`,
  ].join("\n\n")).join("\n\n");
  return [
    `GUIDANCE_RECEIPT: ${receipt}`,
    `TARGET_PATH: ${targetPath || "<root>"}`,
    "The following instructions apply in root-to-leaf order. More specific guides override earlier guides when they conflict.",
    renderedGuides,
  ].filter(Boolean).join("\n\n");
}

function guidanceRequired(targetPath: string, retryTool: string) {
  const argumentsJson = JSON.stringify({ target_path: targetPath });
  return textContent([
    "GUIDANCE_REQUIRED",
    `Call prepare_knowledge_write with ${argumentsJson}.`,
    `Then retry ${retryTool} with the returned guidance_receipt.`,
  ].join("\n\n"), true);
}

export const KNOWLEDGE_BASE_INSTRUCTIONS = "Explore knowledge with browse_directory or get_directory, beginning at the root path when you do not yet know where relevant pages live. Read pages by UUID or semantic path with get_page. The root directory's instructions are the AGENTS.md page at MCP path agents; read it with get_page before choosing a destination when placement is unclear. Before every mutation, call prepare_knowledge_write with the intended target path, follow the complete root-to-leaf guidance it returns, and pass its guidance_receipt to the mutation tool. Create the directory before adding pages beneath a new path. Every page requires a concise one-sentence summary used by generated indexes; a directory summary is optional public-listing copy shown in its parent's generated index. Link pages and directories alike with [[path|label]], or a Markdown heading with [[path#heading-slug|label]]; stable directory references use context-use://directory/<uuid>. Store owner information under about/ and create about/intro as its concise introduction; keep other entities in separate top-level directories. Use load_skill when a listed reusable skill is relevant. Keep knowledge private unless the owner explicitly publishes a page.";

export async function createMcpServer(
  context: McpContext,
  pages: PageRepository,
  directories: DirectoryRepository,
  assets: AssetRepository,
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
  const server = new McpServer({ name: "context-use", version: "0.1.49" }, {
    instructions: `${KNOWLEDGE_BASE_INSTRUCTIONS}\n\n${skillCatalog}`,
  });
  const actor = { kind: "mcp" as const, subject: context.clientId };

  async function hasCurrentGuidance(targetPath: string, receipt?: string): Promise<boolean> {
    if (!receipt) return false;
    const guides = await pages.guidesForPath(targetPath) as ApplicableGuide[];
    return verifyGuidanceReceipt(receipt, guides);
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
    description: "Explore a directory subtree hierarchically. Returns minimal directory metadata, active page metadata, and each directory's AGENTS.md metadata in a prominent guide field. Page bodies and directory introductions are omitted; use get_page for selected pages. Depth 0 includes only pages directly inside the starting directory.",
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
    description: "Create a first-class directory beneath an existing directory. First call prepare_knowledge_write with the new directory path, follow its complete guidance, and pass the returned guidance_receipt. Its title and optional summary are public-listing metadata; the directory becomes immediately linkable by path or stable directory reference.",
    inputSchema: createDirectorySchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "create_directory");
    }
    return jsonContent(await directories.create(input));
  });

  server.registerTool("update_directory", {
    description: "Edit a directory's public-listing title, optional summary, and private Markdown introduction. First call prepare_knowledge_write with the directory's current path, follow its complete guidance, and pass the returned guidance_receipt. Public child listings are generated by the framework.",
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
    description: "Permanently delete one exact, non-root directory only when it is completely empty. This never cascades: descendant active or archived pages, live assets, and child directories are reported and must be deleted first. First use get_directory, then call prepare_knowledge_write with the directory's current path, follow its complete guidance, and pass the returned guidance_receipt.",
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
    description: "Load the complete root and applicable directory AGENTS.md guidance before creating, changing, moving, or archiving knowledge. Returns every guide concatenated in root-to-leaf order and a guidance_receipt to pass to the mutation tool; no additional guide calls are needed.",
    inputSchema: z.object({ target_path: DirectoryPath }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ target_path }) => {
    const guides = await pages.guidesForPath(target_path) as ApplicableGuide[];
    return textContent(preparedGuidance(target_path, createGuidanceReceipt(guides), guides));
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
    description: "Create a private Markdown page and its first immutable version beneath an existing directory. First call prepare_knowledge_write with the intended page path, follow its complete guidance, and pass the returned guidance_receipt. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: createPageSchema.extend({ guidance_receipt: guidanceReceiptSchema }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "create_page");
    }
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency. First call prepare_knowledge_write with the intended page path, follow its complete guidance, and pass the returned guidance_receipt. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: updatePageSchema.extend({
      page_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ page_id, guidance_receipt, ...input }) => {
    if (!await hasCurrentGuidance(input.path, guidance_receipt)) {
      return guidanceRequired(input.path, "update_page");
    }
    return jsonContent(await pages.update(page_id, input, actor));
  });

  server.registerTool("archive_page", {
    description: "Archive an unpublished page. First call prepare_knowledge_write with the page's current path, follow its complete guidance, and pass the returned guidance_receipt. Published pages must be manually unpublished in the dashboard first.",
    inputSchema: archivePageSchema.extend({
      page_id: z.string().uuid(),
      guidance_receipt: guidanceReceiptSchema,
    }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ page_id, guidance_receipt, ...input }) => {
    const page = await pages.get(page_id);
    if (!page) return jsonContent(null);
    if (!await hasCurrentGuidance(page.current_path, guidance_receipt)) {
      return guidanceRequired(page.current_path, "archive_page");
    }
    return jsonContent(await pages.archive(page_id, input, actor));
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
    const capability = createAssetCapability("download", asset.id);
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
    description: "Create a private, checksum-bound asset upload. First call prepare_knowledge_write with the intended asset path, follow its complete guidance, and pass the returned guidance_receipt. PUT the exact raw bytes to the returned URL with every returned header before expires_at. Image uploads return ready-to-paste page Markdown and a safe formatting example. The upload credential cannot read, edit, delete, or publish assets.",
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
    const capability = createAssetCapability("upload", created.id);
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
    description: "Archive a private asset while retaining its immutable stored bytes. First use get_asset, then call prepare_knowledge_write with the asset's current path, follow its complete guidance, and pass the returned guidance_receipt. Published assets and assets referenced by a current active page are rejected. This tool never deletes stored bytes.",
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
