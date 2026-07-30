import {
  AssetRepository,
  DirectoryRepository,
  PageRepository,
} from "@context-use/database";
import {
  archiveAssetSchema,
  archivePageSchema,
  assetUploadSchema,
  createDirectorySchema,
  createPageSchema,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { DirectoryPath, KnowledgePath } from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.ts";
import { createAssetCapability } from "./mcp-asset-capability.ts";

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

export const KNOWLEDGE_BASE_INSTRUCTIONS = "Explore knowledge with browse_directory or get_directory, beginning at the root path when you do not yet know where relevant pages live. Read pages by UUID or semantic path with get_page. Before creating, changing, moving, or archiving knowledge, call prepare_knowledge_write with the intended target path and follow every returned AGENTS.md guide. Create directory metadata before adding pages beneath a new path. Every page and directory requires a concise one-sentence summary used by generated indexes. Link pages and directory indexes alike with [[path|label]], or a Markdown heading with [[path#heading-slug|label]]; stable directory references use context-use://directory/<uuid>. Store owner information under about/ and create about/intro as its concise introduction; keep other entities in separate top-level directories. Use load_skill when a listed reusable skill is relevant. Keep knowledge private unless the owner explicitly publishes a page.";

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
  const server = new McpServer({ name: "context-use", version: "0.1.46" }, {
    instructions: `${KNOWLEDGE_BASE_INSTRUCTIONS}\n\n${skillCatalog}`,
  });
  const actor = { kind: "mcp" as const, subject: context.clientId };

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
    description: "Create a first-class directory beneath an existing directory. Before calling, use prepare_knowledge_write with the new directory path and follow every returned AGENTS.md guide. Its generated index becomes immediately linkable by path or stable directory reference.",
    inputSchema: createDirectorySchema,
    annotations: { destructiveHint: false },
  }, async (input) => jsonContent(await directories.create(input)));

  server.registerTool("update_directory", {
    description: "Edit a directory index title, required summary, and optional Markdown introduction. Before calling, use prepare_knowledge_write with the directory's current path and follow every returned AGENTS.md guide. The generated child listing is maintained by the framework.",
    inputSchema: updateDirectorySchema.extend({ directory_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ directory_id, ...input }) => jsonContent(await directories.update(directory_id, input)));

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
    description: "Load the root and applicable directory AGENTS.md guides before creating, changing, moving, or archiving knowledge. Call with the intended target page or directory path, then follow every guide returned in root-to-leaf order.",
    inputSchema: z.object({ target_path: DirectoryPath }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ target_path }) => {
    return jsonObjectContent({
      target_path,
      guides: await pages.guidesForPath(target_path),
    });
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
    description: "Create a private Markdown page and its first immutable version beneath an existing directory. Before calling, use prepare_knowledge_write with the intended page path and follow every returned AGENTS.md guide. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: createPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency. Before calling, use prepare_knowledge_write with the intended page path and follow every returned AGENTS.md guide. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or to a Markdown heading with [[path#heading-slug|label]]. Stable references may use context-use://page/<uuid>; never store dashboard or public URLs.",
    inputSchema: updatePageSchema.extend({ page_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ page_id, ...input }) => {
    return jsonContent(await pages.update(page_id, input, actor));
  });

  server.registerTool("archive_page", {
    description: "Archive an unpublished page. Before calling, use prepare_knowledge_write with the page's current path and follow every returned AGENTS.md guide. Published pages must be manually unpublished in the dashboard first.",
    inputSchema: archivePageSchema.extend({ page_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: true },
  }, async ({ page_id, ...input }) => {
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
    description: "Create a private, checksum-bound asset upload. PUT the exact raw bytes to the returned URL with every returned header before expires_at. Image uploads return ready-to-paste page Markdown and a safe formatting example. The upload credential cannot read, edit, delete, or publish assets.",
    inputSchema: assetUploadSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
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
    description: "Archive a private asset while retaining its immutable stored bytes. First use get_asset, then call prepare_knowledge_write with the asset's current path and follow every returned AGENTS.md guide. Published assets and assets referenced by a current active page are rejected. This tool never deletes stored bytes.",
    inputSchema: archiveAssetSchema,
    annotations: { destructiveHint: true },
  }, async ({ asset_id }) => {
    return jsonContent(await assets.archive(asset_id));
  });

  return server;
}
