import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markdownObjectMetadata,
  type DocumentMaintenanceRepository,
  type PublicProjectionSnapshot,
} from "@context-use/database";
import { reconcileDocumentObjects } from "./storage-app.ts";
import { FilesystemStorage } from "./storage.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("knowledge document object reconciliation", () => {
  test("materializes a public-safe artifact from an object-backed revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-use-documents-"));
    temporaryRoots.push(root);
    const storage = new FilesystemStorage(root);
    const pageId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";
    const privateTargetId = "33333333-3333-4333-8333-333333333333";
    const body = `Version one with [private context](context-use://page/${privateTargetId}).`;
    let artifact: {
      objectKey: string;
      sizeBytes: number;
      contentHash: string;
    } | null = null;
    const privateMetadata = markdownObjectMetadata(versionId, body);
    const snapshot = (): PublicProjectionSnapshot => ({
      generation: 7,
      pages: !artifact ? [{
        page_id: pageId,
        version_id: versionId,
        source_path: "about/public",
        public_path: "public",
        title: "Public context",
        summary: "Pinned public context.",
        version_created_at: "2026-08-21T10:00:00.000Z",
        ...privateMetadata,
      }] : [],
      pageTargets: [{ id: pageId, source_path: "about/public", public_path: "public" }],
      assetTargets: [],
      directoryTargets: [],
    });
    await storage.write({
      id: versionId,
      objectKey: privateMetadata.body_object_key,
      filename: `${versionId}.md`,
      contentType: "text/markdown; charset=utf-8",
      sizeBytes: privateMetadata.body_size_bytes,
      contentHash: privateMetadata.body_content_hash,
    }, new Blob([body]).stream());
    const maintenance: Pick<DocumentMaintenanceRepository,
      "projectionSnapshot" | "recordPublishedArtifact"> = {
      async projectionSnapshot() {
        return snapshot();
      },
      async recordPublishedArtifact(input) {
        expect(input.pageId).toBe(pageId);
        expect(input.versionId).toBe(versionId);
        expect(input.generation).toBe(7);
        artifact = {
          objectKey: input.objectKey,
          sizeBytes: input.sizeBytes,
          contentHash: input.contentHash,
        };
      },
    };

    await reconcileDocumentObjects({ storage, maintenance });

    expect(artifact).not.toBeNull();
    expect(await new Response(await storage.read(artifact!.objectKey)).text())
      .toBe("Version one with private context.");
    expect(await storage.verify(
      artifact!.objectKey,
      artifact!.sizeBytes,
      artifact!.contentHash,
    )).toBe(true);
    await reconcileDocumentObjects({ storage, maintenance });
  });
});
