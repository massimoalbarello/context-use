import { describe, expect, test } from "bun:test";
import { extractAssetLinks, extractPageLinks } from "../src/links.ts";

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
});
