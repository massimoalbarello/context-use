import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { KnowledgePageChange } from "../types.ts";
import {
  groupKnowledgeChanges,
  KnowledgeChangeDay,
  KnowledgeChangeRow,
} from "./KnowledgeHistory.tsx";

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

describe("knowledge change history days", () => {
  test("sorts changes newest-first and groups them by local calendar day", () => {
    const groups = groupKnowledgeChanges([
      { ...change, cursor: "cu-page-changes-v1.1", changed_at: "2026-07-26T14:40:00.000Z" },
      { ...change, cursor: "cu-page-changes-v1.2", changed_at: "2026-08-07T09:50:00.000Z" },
      { ...change, cursor: "cu-page-changes-v1.3", changed_at: "2026-08-07T10:08:00.000Z" },
    ]);

    expect(groups.map(({ key }) => key)).toEqual(["2026-08-07", "2026-07-26"]);
    expect(groups[0]?.changes.map(({ cursor }) => cursor)).toEqual([
      "cu-page-changes-v1.3",
      "cu-page-changes-v1.2",
    ]);
  });

  test("uses the ledger cursor as a deterministic tie-breaker", () => {
    const groups = groupKnowledgeChanges([
      { ...change, cursor: "cu-page-changes-v1.z" },
      { ...change, cursor: "cu-page-changes-v1.10" },
    ]);

    expect(groups[0]?.changes.map(({ cursor }) => cursor)).toEqual([
      "cu-page-changes-v1.10",
      "cu-page-changes-v1.z",
    ]);
  });

  test("labels the current day and moves the full date into the group heading", () => {
    const group = groupKnowledgeChanges([{ ...change, changed_at: "2026-08-07T10:00:00.000Z" }])[0]!;
    const today = new Date(group.date.getFullYear(), group.date.getMonth(), group.date.getDate(), 18);
    const html = renderToStaticMarkup(<KnowledgeChangeDay
      group={group}
      onOpenPage={() => undefined}
      today={today}
    />);

    expect(html).toContain(">Today<");
    expect(html).toContain("1 change");
    expect(html).toContain("knowledge-change-day-2026-08-07");
  });
});
