import { describe, expect, test } from "bun:test";
import {
  extractAssetLinks,
  extractDocumentLinks,
  extractDirectoryLinks,
  extractPageLinks,
  extractWikiLinks,
  normalizeInternalDocumentLinks,
  normalizeInternalPageLinks,
  wikiLinkCandidatePaths,
} from "../src/links.ts";

describe("hypermedia links", () => {
  test("extracts and deduplicates stable page links", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractPageLinks(`[one](context-use://page/${id}#overview) [two](context-use://page/${id})`)).toEqual([id]);
    expect(extractDocumentLinks(`[one](context-use://document/${id}) ![two](context-use://document/${id})`)).toEqual([id]);
  });

  test("canonicalizes new page and asset references to generic document links", () => {
    const page = "018f3d6d-4050-7c95-8d5a-001122334455";
    const asset = "11111111-1111-4111-8111-111111111111";
    const markdown = `[related](/app/pages/${page}#Useful-Section) ![photo](context-use://asset/${asset})`;
    const canonical = `[related](context-use://document/${page}#useful-section) ![photo](context-use://document/${asset})`;
    expect(normalizeInternalDocumentLinks(markdown)).toBe(canonical);
    expect(normalizeInternalPageLinks(markdown)).toBe(canonical);
    expect(extractPageLinks(markdown)).toEqual([page]);
    expect(extractAssetLinks(markdown)).toEqual([asset]);
    expect(extractDocumentLinks(markdown)).toEqual([page, asset]);
  });

  test("extracts stable directory links and normalizes dashboard index routes", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    const markdown = `[chapters](/app/directories/${id})`;
    expect(normalizeInternalDocumentLinks(markdown)).toBe(`[chapters](context-use://directory/${id})`);
    expect(extractDirectoryLinks(`${markdown} [again](context-use://directory/${id})`)).toEqual([id]);
    expect(extractPageLinks(markdown)).toEqual([]);
  });

  test("extracts assets without treating them as pages", () => {
    const id = "018f3d6d-4050-7c95-8d5a-001122334455";
    expect(extractAssetLinks(`![photo](context-use://asset/${id})`)).toEqual([id]);
    expect(extractPageLinks(`![photo](context-use://asset/${id})`)).toEqual([]);
  });

  test("keeps immutable legacy schemes parseable while emitting only generic links", () => {
    const page = "018f3d6d-4050-7c95-8d5a-001122334455";
    const asset = "11111111-1111-4111-8111-111111111111";
    const directory = "22222222-2222-4222-8222-222222222222";
    const markdown = [
      `[page](context-use://page/${page})`,
      `![asset](context-use://asset/${asset})`,
      `[directory](context-use://directory/${directory})`,
    ].join(" ");

    expect(extractPageLinks(markdown)).toEqual([page]);
    expect(extractAssetLinks(markdown)).toEqual([asset]);
    expect(extractDirectoryLinks(markdown)).toEqual([directory]);
    expect(normalizeInternalDocumentLinks(markdown)).toBe([
      `[page](context-use://document/${page})`,
      `![asset](context-use://document/${asset})`,
      `[directory](context-use://directory/${directory})`,
    ].join(" "));
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
