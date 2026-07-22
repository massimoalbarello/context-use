import { describe, expect, test } from "bun:test";
import {
  extractAssetLinks,
  extractDirectoryLinks,
  extractPageLinks,
  extractWikiLinks,
  normalizeInternalPageLinks,
  wikiLinkCandidatePaths,
} from "../src/links.ts";

describe("hypermedia links", () => {
  test("extracts and deduplicates stable page links", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractPageLinks(`[one](context-use://page/${id}#overview) [two](context-use://page/${id})`)).toEqual([id]);
  });

  test("normalizes legacy private routes without changing page content", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    const markdown = `[related](/app/pages/${id}#useful-section)`;
    expect(normalizeInternalPageLinks(markdown)).toBe(`[related](context-use://page/${id}#useful-section)`);
    expect(extractPageLinks(markdown)).toEqual([id]);
  });

  test("extracts stable directory links and normalizes dashboard index routes", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    const markdown = `[chapters](/app/directories/${id})`;
    expect(normalizeInternalPageLinks(markdown)).toBe(`[chapters](context-use://directory/${id})`);
    expect(extractDirectoryLinks(`${markdown} [again](context-use://directory/${id})`)).toEqual([id]);
    expect(extractPageLinks(markdown)).toEqual([]);
  });

  test("extracts assets without treating them as pages", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractAssetLinks(`![photo](context-use://asset/${id})`)).toEqual([id]);
    expect(extractPageLinks(`![photo](context-use://asset/${id})`)).toEqual([]);
  });

  test("extracts Obsidian wikilinks with aliases and ignores embeds", () => {
    expect(extractWikiLinks(
      "[[about/intro#overview|My intro]] [[about/learnings/claude]] [[about/intro#details|Duplicate]] ![[assets/photo]]",
    )).toEqual([
      { path: "about/intro", label: "My intro" },
      { path: "about/learnings/claude", label: "claude" },
    ]);
  });

  test("prefers the source directory for short Obsidian paths", () => {
    expect(wikiLinkCandidatePaths("claude", "me/learnings/intro")).toEqual([
      "me/learnings/claude",
      "claude",
    ]);
    expect(wikiLinkCandidatePaths("fabric/intro", "about/intro")).toEqual(["fabric/intro"]);
  });
});
