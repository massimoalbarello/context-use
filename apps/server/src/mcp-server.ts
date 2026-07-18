import { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import {
  archiveAutomationPageSchema,
  archivePageSchema,
  assetUploadSchema,
  createAutomationPageSchema,
  createAutomationSkillSchema,
  createCronScheduleSchema,
  createPageSchema,
  type McpScope,
  updateAutomationPageSchema,
  updatePageSchema,
} from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.ts";
import { createAssetDownloadCapability } from "./mcp-asset-download.ts";
import { createAssetUploadCapability } from "./mcp-asset-upload.ts";

export type McpContext = {
  clientId: string;
  userId: string;
  scopes: Set<string>;
};

function requireScope(context: McpContext, scope: McpScope): void {
  if (!context.scopes.has(scope)) throw new Error(`insufficient_scope:${scope}`);
}

const jsonContent = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(
  context: McpContext,
  pages: PageRepository,
  assets: AssetRepository,
  automations: AutomationRepository,
): McpServer {
  const server = new McpServer({ name: "context-use", version: "0.1.18" });
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

  server.registerTool("create_page", {
    description: "Create a private Markdown page and its first immutable version. Link to other knowledge pages with [[path|label]] or context-use://page/<uuid>, never /app/pages or /p URLs; rendering selects an authorized private or public route.",
    inputSchema: createPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "kb:write");
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency. Link to other knowledge pages with [[path|label]] or context-use://page/<uuid>, never /app/pages or /p URLs; rendering selects an authorized private or public route.",
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
    description: "List private asset metadata and organizational paths. Does not reveal S3 keys.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    requireScope(context, "assets:read");
    return jsonContent(await assets.list());
  });

  server.registerTool("get_asset", {
    description: "Get asset metadata and a five-minute, API-proxied download request. Send every returned header to the exact URL before expires_at.",
    inputSchema: z.object({ asset_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ asset_id }) => {
    requireScope(context, "assets:read");
    const asset = await assets.get(asset_id, true);
    if (!asset) return jsonContent(null);
    const capability = createAssetDownloadCapability({
      assetId: asset.id,
      clientId: context.clientId,
      userId: context.userId,
    });
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
    description: "Create a private, checksum-bound asset upload. PUT the exact raw bytes to the returned URL with every returned header before expires_at. The upload credential cannot read, edit, delete, or publish assets.",
    inputSchema: assetUploadSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "assets:write");
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
    const capability = createAssetUploadCapability({
      assetId: created.id,
      clientId: context.clientId,
      userId: context.userId,
    });
    const { objectKey: _hidden, ...asset } = created;
    return jsonContent({
      asset,
      reference: `context-use://asset/${created.id}`,
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

  server.registerTool("list_skills", {
    description: "List skill names and short descriptions for discovery without loading full instructions.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  }, async () => {
    requireScope(context, "skills:read");
    const skills = await automations.listSkills();
    return jsonContent(skills.map(({ id, name, description, current_version_id, version_number }) => ({
      id,
      name,
      description,
      current_version_id,
      version_number,
    })));
  });

  server.registerTool("get_skill", {
    description: "Load one current, standard SKILL.md document after its metadata indicates that it is relevant.",
    inputSchema: z.object({ skill_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ skill_id }) => {
    requireScope(context, "skills:read");
    return jsonContent(await automations.getSkill(skill_id));
  });

  server.registerTool("create_skill", {
    description: "Create a private, versioned Agent Skill with standard name and description metadata.",
    inputSchema: createAutomationSkillSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "skills:write");
    return jsonContent(await automations.createSkill(input, actor));
  });

  server.registerTool("create_automation", {
    description: "Create a scheduled automation for a skill version. The automation receives a dedicated generated-knowledge folder.",
    inputSchema: createCronScheduleSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "automations:write");
    return jsonContent(await automations.createSchedule(input));
  });

  server.registerTool("claim_due_run", {
    description: "Claim the oldest due automation run. Returns its standard SKILL.md, input, dedicated knowledge path, and a six-hour write capability, or null.",
    inputSchema: z.object({}).strict(),
    annotations: { destructiveHint: false },
  }, async () => {
    requireScope(context, "automations:claim");
    return jsonContent(await automations.claimDueRun(context.clientId));
  });

  server.registerTool("create_automation_page", {
    description: "Create generated knowledge inside the claimed automation's dedicated folder. The server resolves the relative path and rejects every other location.",
    inputSchema: createAutomationPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "automations:execute");
    return jsonContent(await pages.createForAutomation(input, actor));
  });

  server.registerTool("update_automation_page", {
    description: "Update a page owned by the claimed automation while keeping it inside that automation's dedicated folder.",
    inputSchema: updateAutomationPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "automations:execute");
    return jsonContent(await pages.updateForAutomation(input, actor));
  });

  server.registerTool("archive_automation_page", {
    description: "Archive a page owned by the claimed automation. Pages outside the automation's folder cannot be targeted.",
    inputSchema: archiveAutomationPageSchema,
    annotations: { destructiveHint: true },
  }, async (input) => {
    requireScope(context, "automations:execute");
    return jsonContent(await pages.archiveForAutomation(input, actor));
  });

  server.registerTool("complete_run", {
    description: "Mark a claimed automation run as successfully completed. Use the run ID and claim token returned by claim_due_run.",
    inputSchema: z.object({
      run_id: z.string().uuid(),
      claim_token: z.string().uuid(),
      result_summary: z.string().trim().min(1).max(10_000).optional(),
    }).strict(),
    annotations: { destructiveHint: false },
  }, async ({ run_id, claim_token, result_summary }) => {
    requireScope(context, "automations:execute");
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
    requireScope(context, "automations:execute");
    return jsonContent(await automations.failRun(run_id, claim_token, context.clientId, error_message));
  });

  return server;
}
