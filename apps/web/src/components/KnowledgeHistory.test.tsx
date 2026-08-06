import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgePageChange } from "../types.ts";
import { KnowledgeChangeRow } from "./KnowledgeHistory.tsx";

const change: KnowledgePageChange = {
  cursor: "cu-page-changes-v1.a",
  page_id: "11111111-1111-4111-8111-111111111111",
  version_id: "22222222-2222-4222-8222-222222222222",
  version_number: 3,
  change_kind: "updated",
  path: "about/intro",
  title: "Introduction",
  commit_message: "Clarify the current introduction",
  actor_kind: "mcp",
  actor_subject: "owner-agent",
  changed_at: "2026-08-06T10:00:00.000Z",
};

describe("knowledge change history row", () => {
  test("shows body-free commit metadata and keeps live pages navigable", () => {
    const html = renderToStaticMarkup(<KnowledgeChangeRow change={change} onOpenPage={() => undefined} />);

    expect(html).toContain("Updated");
    expect(html).toContain("about/intro");
    expect(html).toContain("Clarify the current introduction");
    expect(html).toContain("v3");
    expect(html).toContain("<button");
    expect(html).not.toContain("body_markdown");
  });

  test("renders deletion tombstones without a dead page action", () => {
    const html = renderToStaticMarkup(<KnowledgeChangeRow
      change={{ ...change, change_kind: "deleted", commit_message: "Permanently delete page" }}
      onOpenPage={() => undefined}
    />);

    expect(html).toContain("Deleted");
    expect(html).not.toContain("<button");
  });
});
