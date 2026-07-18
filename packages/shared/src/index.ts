import { z } from "zod";

export const UUID = z.string().uuid();
export const KnowledgePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Use lowercase path segments only")
  .refine((value) => !value.includes("//") && !value.endsWith("/"), "Invalid path");
export const PagePath = KnowledgePath;
export const AssetPath = KnowledgePath;
export const CommitMessage = z.string().trim().min(3).max(240);
export const PublicSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const AutomationName = z.string().trim().min(1).max(160);
export const SkillName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens only");
export const SkillDescription = z.string().trim().min(1).max(1024);
export const CronExpression = z.string().trim().min(9).max(160);
export const TimeZone = z.string().trim().min(1).max(100);
export const AutomationInput = z.record(z.string(), z.unknown());
export const AutomationRelativePath = z
  .string()
  .min(1)
  .max(430)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Use lowercase path segments only")
  .refine((value) => !value.includes("//") && !value.endsWith("/"), "Invalid relative path");

export const createPageSchema = z
  .object({
    path: PagePath,
    title: z.string().trim().min(1).max(240),
    body_markdown: z.string().max(2_000_000),
    commit_message: CommitMessage,
  })
  .strict();

export const updatePageSchema = z
  .object({
    path: PagePath,
    title: z.string().trim().min(1).max(240),
    body_markdown: z.string().max(2_000_000),
    commit_message: CommitMessage,
    expected_version_number: z.number().int().positive(),
  })
  .strict();

export const archivePageSchema = z
  .object({
    commit_message: CommitMessage,
    expected_version_number: z.number().int().positive(),
  })
  .strict();

export const publicationIntentSchema = z
  .object({
    action: z.enum(["publish", "republish", "unpublish"]),
    target_kind: z.enum(["page", "asset"]),
    target_id: UUID,
    version_id: UUID.nullable().optional(),
    public_slug: PublicSlug.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target_kind === "asset" && (value.version_id != null || value.public_slug != null)) {
      context.addIssue({ code: "custom", message: "Asset publication cannot include page fields" });
    }
    if (value.target_kind === "page" && value.action === "unpublish" && (value.version_id != null || value.public_slug != null)) {
      context.addIssue({ code: "custom", message: "Unpublication cannot change a version or slug" });
    }
    if (value.target_kind === "page" && value.action !== "unpublish" && (!value.version_id || !value.public_slug)) {
      context.addIssue({ code: "custom", message: "Page publication requires an exact version and slug" });
    }
  });

export const assetUploadSchema = z.object({
  path: AssetPath,
  filename: z.string().trim().min(1).max(1024),
  content_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().min(0).max(5_000_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration_seconds: z.number().nonnegative().optional(),
}).strict();

export const createAutomationSkillSchema = z.object({
  name: SkillName,
  description: SkillDescription,
  instructions_markdown: z.string().trim().min(1).max(2_000_000),
  commit_message: CommitMessage,
}).strict();

export const updateAutomationSkillSchema = z.object({
  description: SkillDescription,
  instructions_markdown: z.string().trim().min(1).max(2_000_000),
  commit_message: CommitMessage,
  expected_version_number: z.number().int().positive(),
}).strict();

export const createCronScheduleSchema = z.object({
  name: AutomationName,
  skill_version_id: UUID,
  cron_expression: CronExpression,
  timezone: TimeZone,
  input: AutomationInput.default({}),
  enabled: z.boolean().default(true),
}).strict();

export const updateCronScheduleSchema = createCronScheduleSchema.extend({
  enabled: z.boolean(),
}).strict();

const automationRunAccessSchema = z.object({
  run_id: UUID,
  claim_token: UUID,
}).strict();

export const createAutomationPageSchema = automationRunAccessSchema.extend({
  relative_path: AutomationRelativePath,
  title: z.string().trim().min(1).max(240),
  body_markdown: z.string().max(2_000_000),
  commit_message: CommitMessage,
}).strict();

export const updateAutomationPageSchema = createAutomationPageSchema.extend({
  page_id: UUID,
  expected_version_number: z.number().int().positive(),
}).strict();

export const archiveAutomationPageSchema = automationRunAccessSchema.extend({
  page_id: UUID,
  commit_message: CommitMessage,
  expected_version_number: z.number().int().positive(),
}).strict();

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type ArchivePageInput = z.infer<typeof archivePageSchema>;
export type PublicationIntentInput = z.infer<typeof publicationIntentSchema>;
export type AssetUploadInput = z.infer<typeof assetUploadSchema>;
export type CreateAutomationSkillInput = z.infer<typeof createAutomationSkillSchema>;
export type UpdateAutomationSkillInput = z.infer<typeof updateAutomationSkillSchema>;
export type CreateCronScheduleInput = z.infer<typeof createCronScheduleSchema>;
export type UpdateCronScheduleInput = z.infer<typeof updateCronScheduleSchema>;
export type CreateAutomationPageInput = z.infer<typeof createAutomationPageSchema>;
export type UpdateAutomationPageInput = z.infer<typeof updateAutomationPageSchema>;
export type ArchiveAutomationPageInput = z.infer<typeof archiveAutomationPageSchema>;

export type Actor = {
  kind: "dashboard" | "mcp";
  subject: string;
};

export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_slug: string | null;
  automation_id: string | null;
  archived_at: string | null;
  version_number: number;
  title: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  current_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
  published_at: string | null;
  created_at: string;
  deleted_at: string | null;
};

export const MCP_SCOPES = [
  "kb:read",
  "kb:write",
  "assets:read",
  "assets:write",
  "skills:read",
  "skills:write",
  "automations:write",
  "automations:claim",
  "automations:execute",
] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
