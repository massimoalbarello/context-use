import { describe, expect, test } from "bun:test";
import { createPageSchema, publicationIntentSchema, updatePageSchema } from "./index.ts";

const pageId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("strict mutation schemas", () => {
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
});
