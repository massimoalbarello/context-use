import { describe, expect, test } from "bun:test";
import {
  archiveAssetSchema,
  assetFilenameForPath,
  assetUploadSchema,
  createDirectorySchema,
  deleteDirectorySchema,
  AssetPath,
  createPageSchema,
  publicationIntentSchema,
  PAGE_MARKDOWN_BODY_DESCRIPTION,
  summarizeTemplateResult,
  updatePageSchema,
} from "./index.ts";

const pageId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("strict mutation schemas", () => {
  test("describes the safe image and video formatting contract at the page authoring boundary", () => {
    expect(createPageSchema.shape.body_markdown.description).toBe(PAGE_MARKDOWN_BODY_DESCRIPTION);
    expect(updatePageSchema.shape.body_markdown.description).toContain("layout=half");
    expect(updatePageSchema.shape.body_markdown.description).toContain("consecutive images or videos");
    expect(createPageSchema.shape.body_markdown.description).toContain("[[page/path#heading-slug|label]]");
    expect(createPageSchema.shape.body_markdown.description).toContain("shape=auto|square|portrait|landscape");
    expect(createPageSchema.shape.body_markdown.description).toContain("Example: ![Portrait]");
  });

  test("asset paths use the same hierarchical format as page paths", () => {
    expect(AssetPath.safeParse("projects/acme/site-photo").success).toBe(true);
    expect(AssetPath.safeParse("Projects/acme/site-photo.jpg").success).toBe(false);
    expect(AssetPath.safeParse("projects//site-photo").success).toBe(false);
  });

  test("asset uploads bind private metadata to an exact checksum and size", () => {
    expect(assetUploadSchema.safeParse({
      path: "projects/acme/site-photo",
      filename: "site-photo.jpg",
      content_type: "image/jpeg",
      size_bytes: 123,
      sha256: "a".repeat(64),
      width: 800,
      height: 600,
    }).success).toBe(true);
    expect(assetUploadSchema.safeParse({
      path: "projects/acme/site-photo",
      filename: "site-photo.jpg",
      content_type: "image/jpeg",
      size_bytes: 123,
      sha256: "A".repeat(64),
      public_path: "projects/acme/site-photo",
    }).success).toBe(false);
  });

  test("the stored asset filename follows the path leaf and keeps only the extension", () => {
    expect(assetFilenameForPath(
      "library/a-mem-agentic-memory/figures/traditional-vs-agentic-memory",
      "a-mem-figure-1-traditional-vs-agentic-memory.png",
    )).toBe("traditional-vs-agentic-memory.png");
    expect(assetFilenameForPath("library/some-paper/paper", "2401.12345v3.PDF")).toBe("paper.pdf");
    expect(assetFilenameForPath("photos/portrait", "portrait")).toBe("portrait");
    expect(assetFilenameForPath("archives/backup", "backup.tar.gz")).toBe("backup.gz");
  });

  test("asset archival accepts only a stable asset identifier", () => {
    expect(archiveAssetSchema.safeParse({ asset_id: pageId }).success).toBe(true);
    expect(archiveAssetSchema.safeParse({
      asset_id: pageId,
      path: "projects/acme/site-photo",
    }).success).toBe(false);
  });

  test("ordinary page writes reject publication fields", () => {
    expect(createPageSchema.safeParse({
      path: "private/page", title: "Private", summary: "A private page.", body_markdown: "Body", commit_message: "Create page", public_path: "leak",
    }).success).toBe(false);
    expect(updatePageSchema.safeParse({
      path: "private/page", title: "Private", summary: "A private page.", body_markdown: "Body", commit_message: "Update page",
      expected_version_number: 1, published_version_id: versionId,
    }).success).toBe(false);
  });

  test("pages require summaries while directory public-listing summaries are optional", () => {
    expect(createPageSchema.safeParse({
      path: "notes/example", title: "Example", body_markdown: "Body", commit_message: "Create example",
    }).success).toBe(false);
    expect(createPageSchema.safeParse({
      path: "notes/example", title: "Example", summary: "First line.\nSecond line.", body_markdown: "Body", commit_message: "Create example",
    }).success).toBe(false);
    expect(createDirectorySchema.safeParse({
      path: "notes", title: "Notes", summary: "Focused notes and observations.",
    }).success).toBe(true);
    expect(createDirectorySchema.parse({
      path: "empty-notes", title: "Empty notes",
    }).summary).toBe("");
    expect(createDirectorySchema.safeParse({
      path: "notes", title: "Notes", intro_markdown: "Not directory metadata.",
    }).success).toBe(false);
    expect(createDirectorySchema.safeParse({
      path: "notes", title: "Notes", summary: "First line.\nSecond line.",
    }).success).toBe(false);
  });

  test("ordinary page writes reserve about as a folder", () => {
    expect(createPageSchema.safeParse({
      path: "about",
      title: "About",
      summary: "An invalid page at a directory path.",
      body_markdown: "",
      commit_message: "Create about page",
    }).success).toBe(false);
    expect(createPageSchema.safeParse({
      path: "about/intro",
      title: "Intro",
      summary: "A concise introduction to the owner.",
      body_markdown: "",
      commit_message: "Create intro page",
    }).success).toBe(true);
  });

  test("directory deletion is bound to the version the caller inspected", () => {
    expect(deleteDirectorySchema.safeParse({ expected_version_number: 3 }).success).toBe(true);
    expect(deleteDirectorySchema.safeParse({}).success).toBe(false);
    expect(deleteDirectorySchema.safeParse({ expected_version_number: 3, cascade: true }).success).toBe(false);
  });

  test("publication intents bind valid fields to the exact action", () => {
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "page", target_id: pageId, version_id: versionId,
    }).success).toBe(true);
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "page", target_id: pageId,
    }).success).toBe(false);
    expect(publicationIntentSchema.safeParse({
      action: "unpublish", target_kind: "page", target_id: pageId, version_id: versionId,
    }).success).toBe(false);
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "asset", target_id: pageId,
    }).success).toBe(true);
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "page", target_id: pageId, version_id: versionId, public_path: "caller-chosen",
    }).success).toBe(false);
  });

});

describe("knowledge template results", () => {
  test("summarizes shared CLI and dashboard actions from structural replacement metadata", () => {
    expect(summarizeTemplateResult({
      template: "default",
      applied: false,
      actions: [
        { action: "create-directory", path: "topics", detail: "Create Topics" },
        { action: "replace-guide", path: "agents", detail: "Replace the guide", replaces_local: true },
        { action: "conflict", path: "people/agents", detail: "Preserve archived guide" },
        { action: "unchanged", path: "about/agents", detail: "Already current" },
      ],
    })).toEqual({ changes: 2, conflicts: 1, unchanged: 1, replacements: 1 });
  });
});
