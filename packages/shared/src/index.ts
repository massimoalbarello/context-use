import { z } from "zod";

export const PAGE_MARKDOWN_BODY_DESCRIPTION = [
  "Markdown page body.",
  "Use ## or ### headings to create linkable sections; link one with [[page/path#heading-slug|label]].",
  "Heading slugs are lowercase words joined by hyphens (## Next Steps becomes #next-steps); repeated headings add -2, -3, and so on.",
  "Embed an asset with ![Alt](context-use://asset/<uuid>).",
  "Optional safe image or video attributes immediately follow it: {size=small|medium|large|full align=left|center|right shape=auto|square|portrait|landscape layout=block|half|third}.",
  "Use layout=half or layout=third on consecutive images or videos for responsive columns.",
  "Example: ![Portrait](context-use://asset/<uuid>){size=medium align=center shape=square}.",
  "Images and videos with enforced shapes crop with object-fit: cover; assets must be published independently before public pages can render them.",
].join(" ");

export const IMAGE_LAYOUT_STYLES = `.cu-image{box-sizing:border-box;display:block;margin:1rem 0;vertical-align:top}.cu-image>img,.cu-image>video{display:block;width:100%;max-width:none;height:auto}.cu-image--size-small{width:min(100%,240px)}.cu-image--size-medium{width:min(100%,420px)}.cu-image--size-large{width:min(100%,640px)}.cu-image--size-full{width:100%}.cu-image--align-left{margin-right:auto}.cu-image--align-center{margin-right:auto;margin-left:auto}.cu-image--align-right{margin-left:auto}.cu-image--shape-square,.cu-image--shape-portrait,.cu-image--shape-landscape{overflow:hidden}.cu-image--shape-square{aspect-ratio:1/1}.cu-image--shape-portrait{aspect-ratio:4/5}.cu-image--shape-landscape{aspect-ratio:16/9}.cu-image--shape-square>img,.cu-image--shape-square>video,.cu-image--shape-portrait>img,.cu-image--shape-portrait>video,.cu-image--shape-landscape>img,.cu-image--shape-landscape>video{height:100%;object-fit:cover}.cu-image--layout-half,.cu-image--layout-third{display:inline-block;margin:.5rem .5rem .5rem 0}.cu-image--layout-half{width:calc(50% - 1rem)}.cu-image--layout-third{width:calc(33.333% - 1rem)}@media(max-width:640px){.cu-image--layout-half,.cu-image--layout-third{display:block;width:100%;margin:1rem 0}}`;

export const UUID = z.string().uuid();
export const KnowledgePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Use lowercase path segments only")
  .refine((value) => !value.includes("//") && !value.endsWith("/"), "Invalid path");
export const PagePath = KnowledgePath;
export const AssetPath = KnowledgePath;
export const DirectoryPath = z.union([z.literal(""), KnowledgePath]);
const WritablePagePath = PagePath.refine(
  (value) => value !== "about",
  "about is a folder; store its introduction at about/intro",
);
export const CommitMessage = z.string().trim().min(3).max(240);
export const KnowledgeSummary = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => !/[\r\n]/.test(value), "Use a single-line summary")
  .describe("Required one-sentence summary used in generated directory indexes and search results.");
export const DirectorySummary = z
  .string()
  .trim()
  .max(320)
  .refine((value) => !/[\r\n]/.test(value), "Use a single-line summary")
  .describe("Optional public-listing summary shown for this directory in its generated parent index.");
const PageBodyMarkdown = z.string().max(2_000_000).describe(PAGE_MARKDOWN_BODY_DESCRIPTION);

export const createPageSchema = z
  .object({
    path: WritablePagePath,
    title: z.string().trim().min(1).max(240),
    summary: KnowledgeSummary,
    body_markdown: PageBodyMarkdown,
    commit_message: CommitMessage,
  })
  .strict();

export const updatePageSchema = z
  .object({
    path: WritablePagePath,
    title: z.string().trim().min(1).max(240),
    summary: KnowledgeSummary,
    body_markdown: PageBodyMarkdown,
    commit_message: CommitMessage,
    expected_version_number: z.number().int().positive(),
  })
  .strict();

export const createDirectorySchema = z.object({
  path: KnowledgePath,
  title: z.string().trim().min(1).max(240),
  summary: DirectorySummary.default(""),
}).strict();

export const updateDirectorySchema = z.object({
  title: z.string().trim().min(1).max(240),
  summary: DirectorySummary,
  expected_version_number: z.number().int().positive(),
}).strict();

export const deleteDirectorySchema = z.object({
  expected_version_number: z.number().int().positive(),
}).strict();

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

export const archiveAssetSchema = z.object({
  asset_id: UUID,
}).strict();

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type CreateDirectoryInput = z.infer<typeof createDirectorySchema>;
export type UpdateDirectoryInput = z.infer<typeof updateDirectorySchema>;
export type DeleteDirectoryInput = z.infer<typeof deleteDirectorySchema>;
export type ArchivePageInput = z.infer<typeof archivePageSchema>;
export type PublicationIntentInput = z.infer<typeof publicationIntentSchema>;
export type AssetUploadInput = z.infer<typeof assetUploadSchema>;
export type ArchiveAssetInput = z.infer<typeof archiveAssetSchema>;
export type Actor = {
  kind: "dashboard" | "mcp";
  subject: string;
};

export const TEMPLATE_ACTIONS = [
  "create-directory",
  "update-directory",
  "create-guide",
  "adopt-guide",
  "update-guide",
  "replace-guide",
  "create-page",
  "adopt-page",
  "update-page",
  "retire-page",
  "unchanged",
  "conflict",
] as const;

export type TemplateActionKind = typeof TEMPLATE_ACTIONS[number];

export type TemplateAction = {
  action: TemplateActionKind;
  path: string;
  detail: string;
  replaces_local?: true;
};

export type TemplateResult = {
  template: string;
  applied: boolean;
  actions: TemplateAction[];
};

export type TemplateSummary = {
  changes: number;
  conflicts: number;
  unchanged: number;
  replacements: number;
};

export function summarizeTemplateResult(result: TemplateResult): TemplateSummary {
  return result.actions.reduce<TemplateSummary>((summary, action) => {
    if (action.action === "conflict") summary.conflicts += 1;
    else if (action.action === "unchanged") summary.unchanged += 1;
    else summary.changes += 1;
    if (action.replaces_local) summary.replacements += 1;
    return summary;
  }, { changes: 0, conflicts: 0, unchanged: 0, replacements: 0 });
}

export type Page = {
  id: string;
  current_path: string;
  current_version_id: string;
  published_version_id: string | null;
  public_path: string | null;
  archived_at: string | null;
  version_number: number;
  title: string;
  summary: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
};

export type PageMetadata = Pick<
  Page,
  | "id"
  | "current_path"
  | "current_version_id"
  | "published_version_id"
  | "archived_at"
  | "version_number"
  | "title"
  | "summary"
  | "updated_at"
>;

export type Directory = {
  id: string;
  current_path: string;
  version_number: number;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type DirectoryIndexEntry = {
  kind: "directory" | "page";
  id: string;
  path: string;
  title: string;
  summary: string;
  default_page_id: string | null;
};

export type DirectoryIndex = Directory & {
  guide: KnowledgePageMetadata | null;
  children: DirectoryIndexEntry[];
};

export type KnowledgePageMetadata = {
  id: string;
  path: string;
  version_number: number;
  title: string;
  summary: string;
};

export type DirectoryTreeNode = {
  id: string;
  path: string;
  title: string;
  summary: string;
  guide: KnowledgePageMetadata | null;
  pages: KnowledgePageMetadata[];
  directories: DirectoryTreeNode[];
  directories_omitted: number;
};

export type DirectoryTree = DirectoryTreeNode & {
  requested_depth: number;
  max_directories: number;
  max_pages: number;
  truncated: boolean;
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

export const MCP_SCOPE = "mcp:access" as const;
export const MCP_SCOPES = [MCP_SCOPE] as const;
