import { describe, expect, test } from "bun:test";
import {
  assetUploadSchema,
  createAutomationPageSchema,
  createDirectorySchema,
  AssetPath,
  createCronScheduleSchema,
  createPageSchema,
  publicationIntentSchema,
  PAGE_MARKDOWN_BODY_DESCRIPTION,
  updateCronScheduleSchema,
  updatePageSchema,
} from "./index.ts";

const pageId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("strict mutation schemas", () => {
  test("describes the safe image formatting contract at the page authoring boundary", () => {
    expect(createPageSchema.shape.body_markdown.description).toBe(PAGE_MARKDOWN_BODY_DESCRIPTION);
    expect(updatePageSchema.shape.body_markdown.description).toContain("layout=half");
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

  test("ordinary page writes reject publication fields", () => {
    expect(createPageSchema.safeParse({
      path: "private/page", title: "Private", summary: "A private page.", body_markdown: "Body", commit_message: "Create page", public_path: "leak",
    }).success).toBe(false);
    expect(updatePageSchema.safeParse({
      path: "private/page", title: "Private", summary: "A private page.", body_markdown: "Body", commit_message: "Update page",
      expected_version_number: 1, published_version_id: versionId,
    }).success).toBe(false);
  });

  test("pages and directories require concise single-line summaries", () => {
    expect(createPageSchema.safeParse({
      path: "notes/example", title: "Example", body_markdown: "Body", commit_message: "Create example",
    }).success).toBe(false);
    expect(createPageSchema.safeParse({
      path: "notes/example", title: "Example", summary: "First line.\nSecond line.", body_markdown: "Body", commit_message: "Create example",
    }).success).toBe(false);
    expect(createDirectorySchema.safeParse({
      path: "notes", title: "Notes", summary: "Focused notes and observations.", intro_markdown: "Optional introduction.",
    }).success).toBe(true);
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

  test("automations own versioned instructions and immutable semantic keys", () => {
    expect(createCronScheduleSchema.safeParse({
      name: "Morning review",
      automation_key: "morning-review",
      instructions_markdown: "Review current context and save the daily digest.",
      cron_expression: "0 9 * * *",
      timezone: "Europe/London",
      input: { project: "context-use" },
      enabled: true,
    }).success).toBe(true);
    expect(createCronScheduleSchema.safeParse({
      name: "Advertises capabilities",
      automation_key: "Advertises capabilities",
      instructions_markdown: "Review current context.",
      cron_expression: "0 9 * * *",
      timezone: "Europe/London",
      capabilities: ["browser"],
    }).success).toBe(false);
    expect(createCronScheduleSchema.safeParse({
      name: "Missing semantic key",
      instructions_markdown: "Review current context.",
      cron_expression: "0 9 * * *",
      timezone: "Europe/London",
    }).success).toBe(false);
    expect(updateCronScheduleSchema.safeParse({
      name: "Renamed review",
      instructions_markdown: "Review current context and save the daily digest.",
      cron_expression: "0 10 * * *",
      timezone: "Europe/London",
      input: {},
      enabled: true,
      expected_version_number: 1,
    }).success).toBe(true);
    expect(updateCronScheduleSchema.safeParse({
      name: "Attempts key change",
      automation_key: "changed-key",
      instructions_markdown: "Review current context.",
      cron_expression: "0 10 * * *",
      timezone: "Europe/London",
      input: {},
      enabled: true,
      expected_version_number: 1,
    }).success).toBe(false);
  });

  test("automation page writes accept relative paths rather than arbitrary knowledge paths", () => {
    expect(createAutomationPageSchema.safeParse({
      run_id: pageId,
      claim_token: versionId,
      relative_path: "reports/weekly-review",
      title: "Weekly review",
      summary: "The weekly review generated by an automation.",
      body_markdown: "Linked to [[projects/context-use]].",
      commit_message: "Create weekly review",
    }).success).toBe(true);
    expect(createAutomationPageSchema.safeParse({
      run_id: pageId,
      claim_token: versionId,
      relative_path: "../projects/context-use",
      title: "Escape",
      summary: "An invalid path escape attempt.",
      body_markdown: "No",
      commit_message: "Attempt path escape",
    }).success).toBe(false);
  });
});
