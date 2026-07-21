import { describe, expect, test } from "bun:test";
import { filterPagesByPublication, isPublishedPageOutdated } from "./publication-status.ts";
import type { Page } from "./types.ts";

function page(id: string, publishedVersionId: string | null, currentVersionId = `${id}-latest`): Page {
  return {
    id,
    current_path: `pages/${id}`,
    current_version_id: currentVersionId,
    published_version_id: publishedVersionId,
    public_path: publishedVersionId ? `pages/${id}` : null,
    automation_id: null,
    automation_instructions: false,
    archived_at: null,
    version_number: 2,
    title: id,
    body_markdown: "",
  };
}

describe("publication status", () => {
  const privatePage = page("private", null);
  const currentPage = page("current", "current-latest");
  const outdatedPage = page("outdated", "outdated-v1");

  test("only treats a published older snapshot as outdated", () => {
    expect(isPublishedPageOutdated(privatePage)).toBeFalse();
    expect(isPublishedPageOutdated(currentPage)).toBeFalse();
    expect(isPublishedPageOutdated(outdatedPage)).toBeTrue();
  });

  test("filters outdated publications so they can be found from the dashboard", () => {
    const pages = [privatePage, currentPage, outdatedPage];

    expect(filterPagesByPublication(pages, "all")).toEqual(pages);
    expect(filterPagesByPublication(pages, "public")).toEqual([currentPage, outdatedPage]);
    expect(filterPagesByPublication(pages, "updates")).toEqual([outdatedPage]);
  });
});
