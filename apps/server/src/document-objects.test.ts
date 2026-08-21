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
  test("migrates a queued body before materializing its public-safe artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-use-documents-"));
    temporaryRoots.push(root);
    const storage = new FilesystemStorage(root);
    const pageId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";
    const privateTargetId = "33333333-3333-4333-8333-333333333333";
    const body = `Version one with [private context](context-use://page/${privateTargetId}).`;
    let queued = true;
    let migrated = false;
    let artifact: {
      objectKey: string;
      sizeBytes: number;
      contentHash: string;
    } | null = null;
    const privateMetadata = markdownObjectMetadata(versionId, body);
    const snapshot = (): PublicProjectionSnapshot => ({
      generation: 7,
      pages: migrated && !artifact ? [{
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
    const maintenance: Pick<DocumentMaintenanceRepository,
      "legacyKnowledgeRevisions" | "completeLegacyRevision" |
      "projectionSnapshot" | "recordPublishedArtifact"> = {
      async legacyKnowledgeRevisions() {
        return queued ? [{
          id: versionId,
          page_id: pageId,
          version_number: 1,
          body_markdown: body,
          created_at: "2026-08-21T10:00:00.000Z",
        }] : [];
      },
      async completeLegacyRevision(revision, metadata) {
        expect(revision.id).toBe(versionId);
        expect(metadata).toEqual(privateMetadata);
        expect(await storage.verify(
          metadata.body_object_key,
          metadata.body_size_bytes,
          metadata.body_content_hash,
        )).toBe(true);
        queued = false;
        migrated = true;
      },
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

    expect(queued).toBe(false);
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
