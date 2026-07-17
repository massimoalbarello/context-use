import { describe, expect, test } from "bun:test";
import {
  extractAssetLinks,
  extractPageLinks,
  extractWikiLinks,
  wikiLinkCandidatePaths,
} from "../src/links.ts";

describe("hypermedia links", () => {
  test("extracts and deduplicates stable page links", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractPageLinks(`[one](context-use://page/${id}) [two](context-use://page/${id})`)).toEqual([id]);
  });

  test("extracts assets without treating them as pages", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractAssetLinks(`![photo](context-use://asset/${id})`)).toEqual([id]);
    expect(extractPageLinks(`![photo](context-use://asset/${id})`)).toEqual([]);
  });

  test("extracts Obsidian wikilinks with aliases and ignores embeds", () => {
    expect(extractWikiLinks(
      "[[me/intro|My intro]] [[me/learnings/claude]] [[me/intro|Duplicate]] ![[assets/photo]]",
    )).toEqual([
      { path: "me/intro", label: "My intro" },
      { path: "me/learnings/claude", label: "claude" },
    ]);
  });

  test("prefers the source directory for short Obsidian paths", () => {
    expect(wikiLinkCandidatePaths("claude", "me/learnings/intro")).toEqual([
      "me/learnings/claude",
      "claude",
    ]);
    expect(wikiLinkCandidatePaths("fabric/intro", "me/intro")).toEqual(["fabric/intro"]);
  });
});
