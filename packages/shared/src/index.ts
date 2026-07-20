import { z } from "zod";

export const PAGE_MARKDOWN_BODY_DESCRIPTION = [
  "Markdown page body.",
  "Embed an asset with ![Alt](context-use://asset/<uuid>).",
  "Optional safe image attributes immediately follow it: {size=small|medium|large|full align=left|center|right shape=auto|square|portrait|landscape layout=block|half|third}.",
  "Use layout=half or layout=third on consecutive images for responsive columns.",
  "Example: ![Portrait](context-use://asset/<uuid>){size=medium align=center shape=square}.",
  "Images with enforced shapes crop with object-fit: cover; assets must be published independently before public pages can render them.",
].join(" ");

export const IMAGE_LAYOUT_STYLES = `.cu-image{box-sizing:border-box;display:block;margin:1rem 0;vertical-align:top}.cu-image>img{display:block;width:100%;max-width:none;height:auto}.cu-image--size-small{width:min(100%,240px)}.cu-image--size-medium{width:min(100%,420px)}.cu-image--size-large{width:min(100%,640px)}.cu-image--size-full{width:100%}.cu-image--align-left{margin-right:auto}.cu-image--align-center{margin-right:auto;margin-left:auto}.cu-image--align-right{margin-left:auto}.cu-image--shape-square,.cu-image--shape-portrait,.cu-image--shape-landscape{overflow:hidden}.cu-image--shape-square{aspect-ratio:1/1}.cu-image--shape-portrait{aspect-ratio:4/5}.cu-image--shape-landscape{aspect-ratio:16/9}.cu-image--shape-square>img,.cu-image--shape-portrait>img,.cu-image--shape-landscape>img{height:100%;object-fit:cover}.cu-image--layout-half,.cu-image--layout-third{display:inline-block;margin:.5rem .5rem .5rem 0}.cu-image--layout-half{width:calc(50% - 1rem)}.cu-image--layout-third{width:calc(33.333% - 1rem)}@media(max-width:640px){.cu-image--layout-half,.cu-image--layout-third{display:block;width:100%;margin:1rem 0}}`;

export const UUID = z.string().uuid();
export const KnowledgePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Use lowercase path segments only")
  .refine((value) => !value.includes("//") && !value.endsWith("/"), "Invalid path");
export const PagePath = KnowledgePath;
export const AssetPath = KnowledgePath;
const WritablePagePath = PagePath.refine(
  (value) => value !== "about",
  "about is a folder; store its introduction at about/intro",
);
export const CommitMessage = z.string().trim().min(3).max(240);
export const AutomationName = z.string().trim().min(1).max(160);
export const AutomationKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens only");
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

const PageBodyMarkdown = z.string().max(2_000_000).describe(PAGE_MARKDOWN_BODY_DESCRIPTION);

export const createPageSchema = z
  .object({
    path: WritablePagePath,
    title: z.string().trim().min(1).max(240),
    body_markdown: PageBodyMarkdown,
    commit_message: CommitMessage,
  })
  .strict();

export const updatePageSchema = z
  .object({
    path: WritablePagePath,
    title: z.string().trim().min(1).max(240),
    body_markdown: PageBodyMarkdown,
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
    action: z.enum(["publish", "unpublish"]),
    target_kind: z.enum(["page", "asset"]),
    target_id: UUID,
    version_id: UUID.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target_kind === "asset" && value.version_id != null) {
      context.addIssue({ code: "custom", message: "Asset publication cannot include a page version" });
    }
    if (value.action === "unpublish" && value.version_id != null) {
      context.addIssue({ code: "custom", message: "Unpublication cannot select a version" });
    }
    if (value.target_kind === "page" && value.action !== "unpublish" && !value.version_id) {
      context.addIssue({ code: "custom", message: "Page publication requires an exact version" });
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

export const createSkillSchema = z.object({
  name: SkillName,
  description: SkillDescription,
  instructions_markdown: z.string().trim().min(1).max(2_000_000),
  commit_message: CommitMessage,
}).strict();

export const updateSkillSchema = z.object({
  description: SkillDescription,
  instructions_markdown: z.string().trim().min(1).max(2_000_000),
  commit_message: CommitMessage,
  expected_version_number: z.number().int().positive(),
}).strict();

export const createCronScheduleSchema = z.object({
  name: AutomationName,
  automation_key: AutomationKey,
  instructions_markdown: z.string().trim().min(1).max(2_000_000),
  commit_message: CommitMessage.default("Create automation"),
  cron_expression: CronExpression,
  timezone: TimeZone,
  input: AutomationInput.default({}),
  enabled: z.boolean().default(true),
}).strict();

export const updateCronScheduleSchema = createCronScheduleSchema
  .omit({ automation_key: true })
  .extend({
    commit_message: CommitMessage.default("Update automation"),
    enabled: z.boolean(),
    expected_version_number: z.number().int().positive(),
  })
  .strict();

const automationRunAccessSchema = z.object({
  run_id: UUID,
  claim_token: UUID,
}).strict();

export const createAutomationPageSchema = automationRunAccessSchema.extend({
  relative_path: AutomationRelativePath,
  title: z.string().trim().min(1).max(240),
  body_markdown: PageBodyMarkdown,
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
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
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
  public_path: string | null;
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
  public_path: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
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
