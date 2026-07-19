import { describe, expect, test } from "bun:test";
import type { PublicMcpPageSummary } from "@context-use/database";
import {
  buildPublicPageTree,
  publicBreadcrumbs,
  publicChildren,
} from "./hierarchy.ts";

const pages: PublicMcpPageSummary[] = [
  { path: "about/work/project", title: "Project", parent_path: "about/work" },
  { path: "home", title: "Home", parent_path: null },
  { path: "about/work", title: "Work", parent_path: "about" },
  { path: "about", title: "About", parent_path: null },
  { path: "orphan/page", title: "Orphan", parent_path: "unpublished-parent" },
];

describe("public page hierarchy", () => {
  test("nests only explicitly published parents and keeps every public page", () => {
    const tree = buildPublicPageTree(pages, "https://context.example.com");

    expect(tree.map(({ path }) => path)).toEqual(["about", "home", "orphan/page"]);
    expect(tree[0]?.children[0]?.path).toBe("about/work");
    expect(tree[0]?.children[0]?.children[0]?.path).toBe("about/work/project");
    expect(JSON.stringify(tree)).not.toContain("unpublished-parent");
  });

  test("returns published-title breadcrumbs and direct children", () => {
    expect(publicBreadcrumbs("about/work/project", pages, "https://context.example.com").map(({ path }) => path))
      .toEqual(["about", "about/work", "about/work/project"]);
    expect(publicChildren("about", pages, "https://context.example.com"))
      .toEqual([{ path: "about/work", title: "Work", url: "https://context.example.com/p/about/work" }]);
  });

  test("bounds malformed cycles instead of recursing indefinitely", () => {
    const cyclic = [
      { path: "one", title: "One", parent_path: "two" },
      { path: "two", title: "Two", parent_path: "one" },
    ];
    expect(buildPublicPageTree(cyclic, "https://context.example.com")).toEqual([]);
    expect(publicBreadcrumbs("one", cyclic, "https://context.example.com").map(({ path }) => path))
      .toEqual(["two", "one"]);
  });
});
