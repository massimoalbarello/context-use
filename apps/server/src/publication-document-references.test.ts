import { describe, expect, test } from "bun:test";
import { publicationDocumentReferences } from "./publication-document-references.ts";

describe("publication document reference review", () => {
  test("resolves generic links by representation and deduplicates normal and embedded assets", async () => {
    const pageId = "11111111-1111-4111-8111-111111111111";
    const assetId = "22222222-2222-4222-8222-222222222222";
    const recordId = "33333333-3333-4333-8333-333333333333";
    const missingId = "44444444-4444-4444-8444-444444444444";
    const references = await publicationDocumentReferences({
      markdown: [
        `[Download](context-use://document/${assetId})`,
        `![Preview](context-use://document/${assetId})`,
        `[Evidence](context-use://document/${recordId})`,
        `[Missing](context-use://document/${missingId})`,
        `[This page](context-use://document/${pageId})`,
      ].join("\n\n"),
      publishingPage: { id: pageId, title: "Public note", path: "notes/public" },
      lookups: {
        pages: { async metadata() { return null; } },
        assets: {
          async get(id) {
            return id === assetId ? {
              filename: "download.pdf",
              current_path: "files/download",
              public_path: "files/download",
            } : null;
          },
        },
        records: {
          async metadata(id) {
            return id === recordId ? { integration: "github", model: "Issue" } : null;
          },
        },
      },
    });

    expect(references).toEqual([
      {
        kind: "asset",
        id: assetId,
        label: "download.pdf",
        path: "files/download",
        public: true,
      },
      {
        kind: "record",
        id: recordId,
        label: "github Issue record",
        path: null,
        public: false,
      },
      {
        kind: "document",
        id: missingId,
        label: "Missing document",
        path: null,
        public: false,
      },
      {
        kind: "page",
        id: pageId,
        label: "Public note",
        path: "notes/public",
        public: true,
      },
    ]);
  });
});
