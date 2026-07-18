import { describe, expect, test } from "bun:test";
import {
  assetUploadSchema,
  createAutomationPageSchema,
  createAutomationSkillSchema,
  AssetPath,
  createCronScheduleSchema,
  createPageSchema,
  publicationIntentSchema,
  updatePageSchema,
} from "./index.ts";

const pageId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("strict mutation schemas", () => {
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
      published_at: new Date().toISOString(),
    }).success).toBe(false);
  });

  test("ordinary page writes reject publication fields", () => {
    expect(createPageSchema.safeParse({
      path: "private/page", title: "Private", body_markdown: "Body", commit_message: "Create page", public_slug: "leak",
    }).success).toBe(false);
    expect(updatePageSchema.safeParse({
      path: "private/page", title: "Private", body_markdown: "Body", commit_message: "Update page",
      expected_version_number: 1, published_version_id: versionId,
    }).success).toBe(false);
  });

  test("publication intents bind valid fields to the exact action", () => {
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "page", target_id: pageId, version_id: versionId, public_slug: "public-page",
    }).success).toBe(true);
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "page", target_id: pageId, public_slug: "missing-version",
    }).success).toBe(false);
    expect(publicationIntentSchema.safeParse({
      action: "unpublish", target_kind: "page", target_id: pageId, version_id: versionId, public_slug: "change-on-unpublish",
    }).success).toBe(false);
    expect(publicationIntentSchema.safeParse({
      action: "publish", target_kind: "asset", target_id: pageId, public_slug: "asset-has-no-slug",
    }).success).toBe(false);
  });

  test("cron schedules accept only the persisted first-version fields", () => {
    expect(createCronScheduleSchema.safeParse({
      name: "Morning review",
      skill_version_id: versionId,
      cron_expression: "0 9 * * *",
      timezone: "Europe/London",
      input: { project: "context-use" },
      enabled: true,
    }).success).toBe(true);
    expect(createCronScheduleSchema.safeParse({
      name: "Advertises capabilities",
      skill_version_id: versionId,
      cron_expression: "0 9 * * *",
      timezone: "Europe/London",
      capabilities: ["browser"],
    }).success).toBe(false);
  });

  test("skills require standard discovery metadata", () => {
    expect(createAutomationSkillSchema.safeParse({
      name: "review-project-context",
      description: "Reviews project context. Use when preparing a project health check.",
      instructions_markdown: "Inspect the project and record the result.",
      commit_message: "Create review skill",
    }).success).toBe(true);
    expect(createAutomationSkillSchema.safeParse({
      name: "Review Project Context",
      description: "Too display-like",
      instructions_markdown: "Inspect the project.",
      commit_message: "Create invalid skill",
    }).success).toBe(false);
  });

  test("automation page writes accept relative paths rather than arbitrary knowledge paths", () => {
    expect(createAutomationPageSchema.safeParse({
      run_id: pageId,
      claim_token: versionId,
      relative_path: "reports/weekly-review",
      title: "Weekly review",
      body_markdown: "Linked to [[projects/context-use]].",
      commit_message: "Create weekly review",
    }).success).toBe(true);
    expect(createAutomationPageSchema.safeParse({
      run_id: pageId,
      claim_token: versionId,
      relative_path: "../projects/context-use",
      title: "Escape",
      body_markdown: "No",
      commit_message: "Attempt path escape",
    }).success).toBe(false);
  });
});
