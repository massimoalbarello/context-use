import {
  AUTOMATION_RESULT_SUMMARY_MAX_LENGTH,
  AssetRepository,
  AutomationRepository,
  DirectoryRepository,
  PageRepository,
} from "@context-use/database";
import {
  archiveAutomationPageSchema,
  archivePageSchema,
  assetUploadSchema,
  createAutomationPageSchema,
  createCronScheduleSchema,
  createDirectorySchema,
  createPageSchema,
  updateAutomationPageSchema,
  updateDirectorySchema,
  updatePageSchema,
} from "@context-use/shared";
import { DirectoryPath } from "@context-use/shared";
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

export const KNOWLEDGE_BASE_INSTRUCTIONS = "Before managing knowledge, call get_knowledge_base_guide and follow the root AGENTS.md page. Explore progressively with get_directory, beginning at the root path. Create directory metadata before adding pages beneath a new path. Every page and directory requires a concise one-sentence summary used by generated indexes. Link pages and directory indexes alike with [[path|label]]; stable directory references use context-use://directory/<uuid>. Store owner information under about/ and create about/intro as its concise introduction; keep other entities in separate top-level directories. Reusable skills live at skills/<skill-name>. Keep knowledge private unless the owner explicitly publishes a page.";

export function createMcpServer(
  context: McpContext,
  pages: PageRepository,
  directories: DirectoryRepository,
  assets: AssetRepository,
  automations: AutomationRepository,
): McpServer {
  const server = new McpServer({ name: "context-use", version: "0.1.32" }, {
    instructions: KNOWLEDGE_BASE_INSTRUCTIONS,
  });
  const actor = { kind: "mcp" as const, subject: context.clientId };

  server.registerTool("get_knowledge_base_guide", {
    description: "Call before managing knowledge. Read the root AGENTS.md page that defines this knowledge base's structure.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    return jsonContent(await pages.getByPath("agents"));
  });

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

  server.registerTool("list_directories", {
    description: "List directory metadata. Prefer get_directory for progressive exploration.",
    inputSchema: z.object({ query: z.string().trim().min(1).max(500).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query }) => jsonContent(await directories.list(query)));

  server.registerTool("create_directory", {
    description: "Create a first-class directory beneath an existing directory. Its generated index becomes immediately linkable by path or stable directory reference.",
    inputSchema: createDirectorySchema,
    annotations: { destructiveHint: false },
  }, async (input) => jsonContent(await directories.create(input)));

  server.registerTool("update_directory", {
    description: "Edit a directory index title, required summary, and optional Markdown introduction. The generated child listing is maintained by the framework.",
    inputSchema: updateDirectorySchema.extend({ directory_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ directory_id, ...input }) => jsonContent(await directories.update(directory_id, input)));

  server.registerTool("list_pages", {
    description: "List current knowledge pages. Archived pages are excluded unless requested.",
    inputSchema: z.object({ include_archived: z.boolean().default(false) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ include_archived }) => {
    return jsonContent(await pages.list(include_archived));
  });

  server.registerTool("get_page", {
    description: "Get the current version of a knowledge page by stable UUID.",
    inputSchema: z.object({ page_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ page_id }) => {
    return jsonContent(await pages.get(page_id));
  });

  server.registerTool("search_pages", {
    description: "Full-text search current knowledge pages.",
    inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(100).default(30) }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    return jsonContent(await pages.search(query, limit));
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
    description: "Create a private Markdown page and its first immutable version beneath an existing directory. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or use context-use://page/<uuid> and context-use://directory/<uuid>; never store dashboard or public URLs.",
    inputSchema: createPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version, including for an automation-created page, using optimistic concurrency. A one-sentence summary is required for generated indexes. The body_markdown schema documents supported image layouts. Link to pages or directory indexes with [[path|label]], or use stable context-use references; never store dashboard or public URLs.",
    inputSchema: updatePageSchema.extend({ page_id: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ page_id, ...input }) => {
    return jsonContent(await pages.update(page_id, input, actor));
  });

  server.registerTool("archive_page", {
    description: "Archive an unpublished page, including one created by an automation. Published pages must be manually unpublished in the dashboard first.",
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

  server.registerTool("create_automation", {
    description: "Create a scheduled automation whose instructions live in a private page at automations/<automation-key>/instructions and may link to other knowledge pages. The semantic automation_key is immutable.",
    inputSchema: createCronScheduleSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    return jsonContent(await automations.createSchedule(input, actor));
  });

  server.registerTool("claim_due_run", {
    description: "Claim the oldest due automation run. Returns the instruction page's current Markdown with shared execution context, input, dedicated knowledge path, and a one-hour write capability, or null.",
    inputSchema: z.object({}).strict(),
    annotations: { destructiveHint: false },
  }, async () => {
    return jsonContent(await automations.claimDueRun(context.clientId));
  });

  server.registerTool("create_automation_page", {
    description: "When the automation instructions call for page output, create a private page inside the claimed automation's dedicated folder. After creation it follows the ordinary page lifecycle. The server resolves the relative path and rejects every other location.",
    inputSchema: createAutomationPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    return jsonContent(await pages.createForAutomation(input, actor));
  });

  server.registerTool("update_automation_page", {
    description: "Update a page owned by the claimed automation while keeping it inside that automation's dedicated folder.",
    inputSchema: updateAutomationPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    return jsonContent(await pages.updateForAutomation(input, actor));
  });

  server.registerTool("archive_automation_page", {
    description: "Archive an unpublished page created by the claimed automation. The run claim and automation provenance scope access even if an ordinary edit previously moved the page.",
    inputSchema: archiveAutomationPageSchema,
    annotations: { destructiveHint: true },
  }, async (input) => {
    return jsonContent(await pages.archiveForAutomation(input, actor));
  });

  server.registerTool("complete_run", {
    description: "Mark a claimed automation run as successfully completed. Page output is optional; when present, the page is the canonical output. Use result_summary only for an optional short dashboard note, never to repeat page contents.",
    inputSchema: z.object({
      run_id: z.string().uuid(),
      claim_token: z.string().uuid(),
      result_summary: z.string().trim().min(1).max(AUTOMATION_RESULT_SUMMARY_MAX_LENGTH)
        .describe("Optional one- or two-sentence note saying what changed and where. Omit it when the run status and knowledge page are sufficient; never paste the page contents here.")
        .optional(),
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ run_id, claim_token, result_summary }) => {
    return jsonContent(await automations.completeRun(run_id, claim_token, context.clientId, result_summary));
  });

  server.registerTool("fail_run", {
    description: "Mark a claimed automation run as failed and persist a concise error for the owner dashboard.",
    inputSchema: z.object({
      run_id: z.string().uuid(),
      claim_token: z.string().uuid(),
      error_message: z.string().trim().min(1).max(10_000),
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ run_id, claim_token, error_message }) => {
    return jsonContent(await automations.failRun(run_id, claim_token, context.clientId, error_message));
  });

  return server;
}
