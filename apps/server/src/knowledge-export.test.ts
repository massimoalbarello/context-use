import { describe, expect, test } from "bun:test";
import type { KnowledgeExportSnapshot } from "@context-use/database";
import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";
import { planKnowledgeExport, streamKnowledgeExport } from "./knowledge-export.ts";
import type { ObjectStorage } from "./storage.ts";

const pageOne = "11111111-1111-4111-8111-111111111111";
const pageTwo = "22222222-2222-4222-8222-222222222222";
const assetOne = "33333333-3333-4333-8333-333333333333";

function snapshot(): KnowledgeExportSnapshot {
  return {
    pages: [
      {
        id: pageOne,
        current_path: "projects/acme/brief",
        title: "Q3 Brief",
        body_markdown: [
          `[Other](context-use://page/${pageTwo})`,
          `[Legacy](/app/pages/${pageTwo})`,
          "[[notes/other|Wiki label]]",
          `![Site photo](context-use://asset/${assetOne})`,
          `[Missing](context-use://page/44444444-4444-4444-8444-444444444444)`,
        ].join("\n\n"),
      },
      {
        id: pageTwo,
        current_path: "notes/other",
        title: "Other Note",
        body_markdown: "Back to [[projects/acme/brief]].",
      },
    ],
    assets: [{
      id: assetOne,
      current_path: "projects/acme/site-photo",
      filename: "site photo.jpg",
      content_type: "image/jpeg",
      size_bytes: 11,
      content_hash: "a".repeat(64),
      s3_object_key: `objects/${assetOne}`,
    }],
  };
}

describe("portable knowledge export", () => {
  test("uses friendly filesystem names and rewrites every private reference locally", () => {
    const planned = planKnowledgeExport(snapshot());
    const brief = planned.pages.find(({ id }) => id === pageOne)!;
    const other = planned.pages.find(({ id }) => id === pageTwo)!;

    expect(brief.vaultPath).toBe("projects/acme/Q3 Brief.md");
    expect(other.vaultPath).toBe("notes/Other Note.md");
    expect(planned.assets[0]?.vaultPath).toBe("projects/acme/site photo.jpg");
    expect(brief.body).toBe([
      "[Other](../../notes/Other%20Note.md)",
      "[Legacy](../../notes/Other%20Note.md)",
      "[Wiki label](../../notes/Other%20Note.md)",
      "![Site photo](site%20photo.jpg)",
      "Missing",
    ].join("\n\n"));
    expect(other.body).toBe("Back to [brief](../projects/acme/Q3%20Brief.md).");
    expect(planned.pages.map(({ body }) => body).join("\n")).not.toContain("context-use://");
  });

  test("resolves friendly-name and directory collisions without database identifiers", () => {
    const planned = planKnowledgeExport({
      pages: [
        { id: pageOne, current_path: "folder/first", title: "Report", body_markdown: "" },
        { id: pageTwo, current_path: "folder/second", title: "report", body_markdown: "" },
        { id: "44444444-4444-4444-8444-444444444444", current_path: "folder/sub/page", title: "Nested", body_markdown: "" },
      ],
      assets: [
        {
          id: assetOne,
          current_path: "folder/report-asset",
          filename: "Report.md",
          content_type: "text/markdown",
          size_bytes: 0,
          content_hash: "a".repeat(64),
          s3_object_key: `objects/${assetOne}`,
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          current_path: "folder/sub-asset",
          filename: "sub",
          content_type: "application/octet-stream",
          size_bytes: 0,
          content_hash: "b".repeat(64),
          s3_object_key: "objects/55555555-5555-4555-8555-555555555555",
        },
      ],
    });
    const paths = [...planned.pages, ...planned.assets].map(({ vaultPath }) => vaultPath);
    expect(new Set(paths.map((path) => path.toLowerCase())).size).toBe(paths.length);
    expect(paths.some((path) => path === "folder/sub")).toBe(false);
    for (const path of paths) expect(path).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  test("streams a readable Zip64 vault containing page text and original asset bytes", async () => {
    const assetBytes = new TextEncoder().encode("asset-bytes");
    const storage: ObjectStorage = {
      write: async () => undefined,
      delete: async () => undefined,
      verify: async () => true,
      read: async (key) => {
        expect(key).toBe(`objects/${assetOne}`);
        return new Blob([assetBytes]);
      },
    };
    const archive = await new Response(streamKnowledgeExport(snapshot(), storage)).blob();
    const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
    const entries = await reader.getEntries();
    expect(entries.map(({ filename }) => filename)).toEqual([
      "context-use-export/projects/acme/Q3 Brief.md",
      "context-use-export/notes/Other Note.md",
      "context-use-export/projects/acme/site photo.jpg",
    ]);
    const brief = entries.find(({ filename }) => filename.endsWith("Q3 Brief.md"))!;
    if (!("getData" in brief)) throw new Error("Expected the exported page to be a file");
    expect(await brief.getData(new TextWriter())).toContain("../../notes/Other%20Note.md");
    const asset = entries.find(({ filename }) => filename.endsWith("site photo.jpg"))!;
    if (!("getData" in asset)) throw new Error("Expected the exported asset to be a file");
    const assetBlob = await asset.getData(new BlobWriter());
    expect(new Uint8Array(await assetBlob.arrayBuffer())).toEqual(assetBytes);
    await reader.close();
  });

  test("produces a valid empty vault when there is no active knowledge", async () => {
    const storage: ObjectStorage = {
      write: async () => undefined,
      delete: async () => undefined,
      verify: async () => true,
      read: async () => { throw new Error("No asset read expected"); },
    };
    const archive = await new Response(streamKnowledgeExport({ pages: [], assets: [] }, storage)).blob();
    const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
    expect(await reader.getEntries()).toEqual([]);
    await reader.close();
  });
});
