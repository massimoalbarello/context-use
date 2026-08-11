import { describe, expect, test } from "bun:test";
import { markdownChanges, pageDelta, type MarkdownChange } from "./page-delta.ts";

function markdownLines(markdown: string): string[] {
  return markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function applyChanges(markdown: string, changes: MarkdownChange[]): string {
  const lines = markdownLines(markdown);
  for (const change of changes.toReversed()) {
    lines.splice(
      change.old_start_line - 1,
      change.old_line_count,
      ...markdownLines(change.after_markdown),
    );
  }
  return lines.join("");
}

describe("page delta", () => {
  test("isolates a one-word edit without returning unchanged paragraphs", async () => {
    const before = [
      "# Project\n",
      "\n",
      "The first paragraph remains unchanged.\n",
      "\n",
      "We agreed to meet on Tuesday.\n",
      "\n",
      "The last paragraph remains unchanged.\n",
    ].join("");
    const after = before.replace("Tuesday", "Wednesday");

    const changes = await markdownChanges(before, after);

    expect(changes).toEqual([{
      old_start_line: 5,
      old_line_count: 1,
      new_start_line: 5,
      new_line_count: 1,
      before_markdown: "We agreed to meet on Tuesday.\n",
      after_markdown: "We agreed to meet on Wednesday.\n",
      inline_changes: [
        { kind: "removed", value: "Tuesday" },
        { kind: "added", value: "Wednesday" },
      ],
    }]);
    expect(JSON.stringify(changes)).not.toContain("first paragraph");
    expect(JSON.stringify(changes)).not.toContain("last paragraph");
  });

  test("keeps distant edits in separate exact blocks", async () => {
    const before = "one\ntwo\nthree\nfour\nfive\n";
    const after = "ONE\ntwo\nthree\nfour\nFIVE\nsix\n";
    const changes = await markdownChanges(before, after);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      old_start_line: 1,
      new_start_line: 1,
      before_markdown: "one\n",
      after_markdown: "ONE\n",
    });
    expect(changes[1]).toMatchObject({
      old_start_line: 5,
      new_start_line: 5,
      before_markdown: "five\n",
      after_markdown: "FIVE\nsix\n",
    });
    expect(applyChanges(before, changes)).toBe(after);
  });

  test.each([
    ["", "new page\n"],
    ["delete me\n", ""],
    ["a\nb", "a\nb\n"],
    ["alpha\r\nbeta\r\n", "alpha\nbeta\n"],
    ["coffee ☕\n東京\n", "coffee and tea ☕\n東京へ\n"],
    ["a\nb\nc\n", "before\na\nc\nafter\n"],
  ])("reports changes that reconstruct the exact later Markdown", async (before, after) => {
    const changes = await markdownChanges(before, after);
    expect(applyChanges(before, changes)).toBe(after);
  });

  test("reports structured metadata changes and a new-page baseline", async () => {
    const delta = await pageDelta(null, {
      path: "projects/context-use/intro",
      title: "Context Use",
      summary: "A linked knowledge system.",
      body_markdown: "# Context Use\n\nStarted today.\n",
    });

    expect(delta.metadata_changes).toEqual([
      { field: "path", before: null, after: "projects/context-use/intro" },
      { field: "title", before: null, after: "Context Use" },
      { field: "summary", before: null, after: "A linked knowledge system." },
    ]);
    expect(delta.markdown_changes).toEqual([{
      old_start_line: 1,
      old_line_count: 0,
      new_start_line: 1,
      new_line_count: 3,
      before_markdown: "",
      after_markdown: "# Context Use\n\nStarted today.\n",
    }]);
  });

  test("returns no changes for identical versions", async () => {
    const version = {
      path: "people/ada/intro",
      title: "Ada",
      summary: "A collaborator.",
      body_markdown: "# Ada\n",
    };
    expect(await pageDelta(version, version)).toEqual({
      metadata_changes: [],
      markdown_changes: [],
    });
  });

  test("keeps a large replacement exact when inline refinement is omitted", async () => {
    const before = `${"before ".repeat(2_000)}\n`;
    const after = `${"after ".repeat(2_000)}\n`;
    const changes = await markdownChanges(before, after);

    expect(changes).toHaveLength(1);
    expect(changes[0]?.before_markdown).toBe(before);
    expect(changes[0]?.after_markdown).toBe(after);
    expect(changes[0]?.inline_changes).toBeUndefined();
    expect(applyChanges(before, changes)).toBe(after);
  });
});
