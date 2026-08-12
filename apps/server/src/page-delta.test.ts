import { describe, expect, test } from "bun:test";
import { markdownChanges, pageDelta } from "./page-delta.ts";

describe("page delta", () => {
  test("isolates a one-word edit without returning unchanged paragraphs or duplicate representations", async () => {
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
      before: "We agreed to meet on Tuesday.\n",
      after: "We agreed to meet on Wednesday.\n",
    }]);
    expect(JSON.stringify(changes)).not.toContain("first paragraph");
    expect(JSON.stringify(changes)).not.toContain("last paragraph");
    expect(Object.keys(changes[0] ?? {})).toEqual(["before", "after"]);
  });

  test("returns several distant Markdown edits as separate clean fragments", async () => {
    const before = [
      "# A busy day\n",
      "\n",
      "The opening remains unchanged.\n",
      "\n",
      "## Work\n",
      "\n",
      "The draft was reviewed.\n",
      "\n",
      "The bridge remains unchanged.\n",
      "\n",
      "## Evening\n",
      "\n",
      "Walked home.\n",
      "\n",
      "The ending remains unchanged.\n",
    ].join("");
    const after = before
      .replace("The draft was reviewed.", "The pull request was reviewed.")
      .replace("Walked home.", "Walked home with Ada.\nPrepared tomorrow's notes.");

    const changes = await markdownChanges(before, after);

    expect(changes).toEqual([
      {
        before: "The draft was reviewed.\n",
        after: "The pull request was reviewed.\n",
      },
      {
        before: "Walked home.\n",
        after: "Walked home with Ada.\nPrepared tomorrow's notes.\n",
      },
    ]);
    const output = JSON.stringify(changes);
    expect(output).not.toContain("opening remains");
    expect(output).not.toContain("bridge remains");
    expect(output).not.toContain("ending remains");
  });

  test.each([
    ["new-page insertion", "", "new page\n", [{ before: "", after: "new page\n" }]],
    ["whole-page deletion", "delete me\n", "", [{ before: "delete me\n", after: "" }]],
    ["final newline", "a\nb", "a\nb\n", [{ before: "b", after: "b\n" }]],
    [
      "line endings",
      "alpha\r\nbeta\r\n",
      "alpha\nbeta\n",
      [{ before: "alpha\r\nbeta\r\n", after: "alpha\nbeta\n" }],
    ],
    [
      "Unicode",
      "coffee ☕\n東京\n",
      "coffee and tea ☕\n東京へ\n",
      [{ before: "coffee ☕\n東京\n", after: "coffee and tea ☕\n東京へ\n" }],
    ],
  ])("returns exact before/after text for %s", async (_name, before, after, expected) => {
    expect(await markdownChanges(before, after)).toEqual(expected);
  });

  test("reports structured metadata changes and a new-page baseline", async () => {
    const delta = await pageDelta(null, {
      path: "projects/context-use/intro",
      title: "Context Use",
      summary: "A linked knowledge system.",
      body_markdown: "# Context Use\n\nStarted today.\n",
    });

    expect(delta).toEqual({
      metadata_changes: [
        { field: "path", before: null, after: "projects/context-use/intro" },
        { field: "title", before: null, after: "Context Use" },
        { field: "summary", before: null, after: "A linked knowledge system." },
      ],
      markdown_changes: [{
        before: "",
        after: "# Context Use\n\nStarted today.\n",
      }],
    });
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

  test("keeps a large replacement exact without adding another diff representation", async () => {
    const before = `${"before ".repeat(2_000)}\n`;
    const after = `${"after ".repeat(2_000)}\n`;

    expect(await markdownChanges(before, after)).toEqual([{ before, after }]);
  });
});
