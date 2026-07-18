import { describe, expect, test } from "bun:test";
import type { PublicMcpPageSummary } from "@context-use/database";
import {
  buildPublicPageTree,
  publicBreadcrumbs,
  publicChildren,
} from "./hierarchy.ts";

const pages: PublicMcpPageSummary[] = [
  { slug: "project", title: "Project", parent_slug: "work" },
  { slug: "home", title: "Home", parent_slug: null },
  { slug: "work", title: "Work", parent_slug: "about" },
  { slug: "about", title: "About", parent_slug: null },
  { slug: "orphan", title: "Orphan", parent_slug: "unpublished-parent" },
];

describe("public page hierarchy", () => {
  test("nests only explicitly published parents and keeps every public page", () => {
    const tree = buildPublicPageTree(pages, "https://context.example.com");

    expect(tree.map(({ slug }) => slug)).toEqual(["about", "home", "orphan"]);
    expect(tree[0]?.children[0]?.slug).toBe("work");
    expect(tree[0]?.children[0]?.children[0]?.slug).toBe("project");
    expect(JSON.stringify(tree)).not.toContain("unpublished-parent");
  });

  test("returns published-title breadcrumbs and direct children", () => {
    expect(publicBreadcrumbs("project", pages, "https://context.example.com").map(({ slug }) => slug))
      .toEqual(["about", "work", "project"]);
    expect(publicChildren("about", pages, "https://context.example.com"))
      .toEqual([{ slug: "work", title: "Work", url: "https://context.example.com/p/work" }]);
  });

  test("bounds malformed cycles instead of recursing indefinitely", () => {
    const cyclic = [
      { slug: "one", title: "One", parent_slug: "two" },
      { slug: "two", title: "Two", parent_slug: "one" },
    ];
    expect(buildPublicPageTree(cyclic, "https://context.example.com")).toEqual([]);
    expect(publicBreadcrumbs("one", cyclic, "https://context.example.com").map(({ slug }) => slug))
      .toEqual(["two", "one"]);
  });
});
