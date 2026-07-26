import { describe, expect, test } from "bun:test";
import type { DirectoryIndexEntry } from "../types.ts";
import { selectionForDirectoryEntry } from "./DirectoryEditor.tsx";

function entry(overrides: Partial<DirectoryIndexEntry> = {}): DirectoryIndexEntry {
  return {
    kind: "directory",
    id: "11111111-1111-4111-8111-111111111111",
    path: "about/projects/alarm-clock",
    title: "The special alarm clock",
    summary: "A one-page project with supporting assets.",
    default_page_id: null,
    ...overrides,
  };
}

describe("directory index navigation", () => {
  test("opens the sole page of a collapsible child directory", () => {
    expect(selectionForDirectoryEntry(entry({
      default_page_id: "22222222-2222-4222-8222-222222222222",
    }))).toEqual({
      kind: "page",
      id: "22222222-2222-4222-8222-222222222222",
    });
  });

  test("keeps ordinary directories and direct pages on their own targets", () => {
    expect(selectionForDirectoryEntry(entry())).toEqual({
      kind: "directory",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(selectionForDirectoryEntry(entry({
      kind: "page",
      id: "33333333-3333-4333-8333-333333333333",
      default_page_id: null,
    }))).toEqual({
      kind: "page",
      id: "33333333-3333-4333-8333-333333333333",
    });
  });
});
