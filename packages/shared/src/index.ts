import { z } from "zod";

export const UUID = z.string().uuid();
export const PagePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "Use lowercase path segments only")
  .refine((value) => !value.includes("//") && !value.endsWith("/"), "Invalid path");
export const CommitMessage = z.string().trim().min(3).max(240);
export const PublicSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

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

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type ArchivePageInput = z.infer<typeof archivePageSchema>;
export type PublicationIntentInput = z.infer<typeof publicationIntentSchema>;

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
  archived_at: string | null;
  version_number: number;
  title: string;
  body_markdown: string;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
  published_at: string | null;
  created_at: string;
  deleted_at: string | null;
};

export const MCP_SCOPES = ["kb:read", "kb:write", "assets:read"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
