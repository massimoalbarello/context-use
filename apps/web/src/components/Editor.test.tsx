import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PageVersionDiff } from "../types.ts";
import { VersionDiffContents } from "./Editor.tsx";

describe("page version diff", () => {
  test("renders changed metadata and compact Markdown additions and removals", () => {
    const diff: PageVersionDiff = {
      page_id: "11111111-1111-4111-8111-111111111111",
      comparison: { from_version: 2, to_version: 3 },
      metadata_changes: [{ field: "title", before: "Old title", after: "New title" }],
      markdown_changes: [{
        before: "A sentence that changed.\n",
        after: "A clearer sentence.\n",
      }],
    };

    const html = renderToStaticMarkup(<VersionDiffContents diff={diff} />);

    expect(html).toContain("Page details");
    expect(html).toContain("Old title");
    expect(html).toContain("New title");
    expect(html).toContain("Page content");
    expect(html).toContain("A sentence that changed.");
    expect(html).toContain("A clearer sentence.");
    expect(html).toContain("diff-value removed");
    expect(html).toContain("diff-value added");
  });

  test("explains versions with no page-content changes", () => {
    const diff: PageVersionDiff = {
      page_id: "11111111-1111-4111-8111-111111111111",
      comparison: { from_version: 3, to_version: 4 },
      metadata_changes: [],
      markdown_changes: [],
    };

    expect(renderToStaticMarkup(<VersionDiffContents diff={diff} />))
      .toContain("No page-content changes in this version.");
  });
});
