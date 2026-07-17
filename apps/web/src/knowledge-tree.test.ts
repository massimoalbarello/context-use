import { describe, expect, test } from "bun:test";
import {
  allDirectoryPaths,
  buildPageTree,
  directoryPathsForPage,
  parseExpandedPaths,
  serializeExpandedPaths,
} from "./knowledge-tree.ts";
import type { Page } from "./types.ts";

function page(id: string, currentPath: string, title: string): Page {
  return {
    id,
    current_path: currentPath,
    current_version_id: `version-${id}`,
    published_version_id: null,
    public_slug: null,
    archived_at: null,
    version_number: 1,
    title,
    body_markdown: "",
  };
}

describe("knowledge tree", () => {
  const pages = [
    page("claude", "me/learnings/claude", "Learnings"),
    page("intro", "me/intro", "Intro"),
    page("airbyte", "me/learnings/entrepreneurship/airbyte", "Airbyte's Origin Story"),
    page("root", "conduct", "Conduct"),
    page("science", "me/learnings/science/physics", "Physics"),
  ];

  test("groups path segments into sorted nested directories", () => {
    const tree = buildPageTree(pages);

    expect(tree.pages.map(({ name }) => name)).toEqual(["conduct"]);
    expect(tree.directories.map(({ path }) => path)).toEqual(["me"]);
    expect(tree.directories[0]!.pages.map(({ name }) => name)).toEqual(["intro"]);
    expect(tree.directories[0]!.directories.map(({ path }) => path)).toEqual(["me/learnings"]);
    expect(tree.directories[0]!.directories[0]!.directories.map(({ name }) => name)).toEqual([
      "entrepreneurship",
      "science",
    ]);
  });

  test("returns the ancestors needed to reveal a selected page", () => {
    expect(directoryPathsForPage(pages[2]!)).toEqual([
      "me",
      "me/learnings",
      "me/learnings/entrepreneurship",
    ]);
  });

  test("returns every directory path so search results can be revealed", () => {
    expect(allDirectoryPaths(buildPageTree(pages))).toEqual([
      "me",
      "me/learnings",
      "me/learnings/entrepreneurship",
      "me/learnings/science",
    ]);
  });

  test("round-trips the expanded directory state for reloads", () => {
    const serialized = serializeExpandedPaths(new Set(["me/learnings/science", "me", "me/learnings"]));
    expect(serialized).toBe('["me","me/learnings","me/learnings/science"]');
    expect([...parseExpandedPaths(serialized)!]).toEqual([
      "me",
      "me/learnings",
      "me/learnings/science",
    ]);
    expect(parseExpandedPaths("not json")).toBeNull();
  });
});
