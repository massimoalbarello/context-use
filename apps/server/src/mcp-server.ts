import { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import {
  archivePageSchema,
  createAutomationSkillSchema,
  createCronScheduleSchema,
  createPageSchema,
  type McpScope,
  updatePageSchema,
} from "@context-use/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObjectStorage } from "./storage.ts";

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
  storage: ObjectStorage,
): McpServer {
  const server = new McpServer({ name: "context-use", version: "0.1.10" });
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
    description: "Create a private Markdown page and its first immutable version.",
    inputSchema: createPageSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "kb:write");
    return jsonContent(await pages.create(input, actor));
  });

  server.registerTool("update_page", {
    description: "Create a new private page version using optimistic concurrency.",
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
    description: "Get asset metadata and a five-minute authorized download URL.",
    inputSchema: z.object({ asset_id: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, async ({ asset_id }) => {
    requireScope(context, "assets:read");
    const asset = await assets.get(asset_id, true);
    if (!asset) return jsonContent(null);
    const download_url = await storage.createDownload({
      objectKey: asset.s3_object_key,
      filename: asset.filename,
      contentType: asset.content_type,
    });
    const { s3_object_key: _hidden, ...metadata } = asset;
    return jsonContent({ ...metadata, download_url, expires_in: 300 });
  });

  server.registerTool("create_automation_skill", {
    description: "Create a private, versioned automation skill. Returns the skill and its current skill version ID for scheduling.",
    inputSchema: createAutomationSkillSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "automations:write");
    return jsonContent(await automations.createSkill(input, actor));
  });

  server.registerTool("create_cron_schedule", {
    description: "Create a cron schedule for an automation skill version. Enabled schedules become eligible when claim_due_run is polled.",
    inputSchema: createCronScheduleSchema,
    annotations: { destructiveHint: false },
  }, async (input) => {
    requireScope(context, "automations:write");
    return jsonContent(await automations.createSchedule(input));
  });

  server.registerTool("claim_due_run", {
    description: "Claim the oldest due automation run. Returns the exact persisted skill instructions and inputs, or null when no work is ready. The claim is leased for six hours.",
    inputSchema: z.object({}).strict(),
    annotations: { destructiveHint: false },
  }, async () => {
    requireScope(context, "automations:claim");
    return jsonContent(await automations.claimDueRun(context.clientId));
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
