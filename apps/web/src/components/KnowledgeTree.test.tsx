import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Directory } from "../types.ts";
import { KnowledgeTree } from "./KnowledgeTree.tsx";

function directory(id: string, currentPath: string, title: string): Directory {
  return {
    id,
    current_path: currentPath,
    version_number: 1,
    title,
    summary: `Summary for ${title}.`,
    intro_markdown: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("knowledge tree root", () => {
  test("renders the root directory as the expandable parent of top-level folders", () => {
    const html = renderToStaticMarkup(<KnowledgeTree
      pages={[]}
      assets={[]}
      directories={[
        directory("root", "", "Knowledge"),
        directory("about", "about", "About"),
      ]}
      query="about"
      selected={null}
      onSelect={() => undefined}
    />);
    const root = html.indexOf('aria-label="Knowledge"');
    const rootButton = html.lastIndexOf("<button", root);
    const children = html.indexOf('role="group"', root);
    const about = html.indexOf('aria-label="about"', children);
    const aboutButton = html.lastIndexOf("<button", about);

    expect(root).toBeGreaterThan(-1);
    expect(html.slice(rootButton, children)).toContain('aria-expanded="true"');
    expect(children).toBeGreaterThan(root);
    expect(about).toBeGreaterThan(children);
    expect(html.slice(aboutButton, about)).toContain("--tree-depth:1");
  });
});
