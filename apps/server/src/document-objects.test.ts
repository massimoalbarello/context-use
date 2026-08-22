import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markdownObjectMetadata,
  type DocumentMaintenanceRepository,
  type PublicProjectionSnapshot,
  type UnindexedDocumentRevision,
} from "@context-use/database";
import { reconcileDocumentLinks, reconcileDocumentObjects } from "./storage-app.ts";
import { FilesystemStorage, type ObjectStorageBackend } from "./storage.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe("knowledge document object reconciliation", () => {
  test("indexes every stored revision, including an empty resolved target set", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-use-document-links-"));
    temporaryRoots.push(root);
    const storage = new FilesystemStorage(root);
    const revisionId = "11111111-1111-4111-8111-111111111111";
    const targetId = "22222222-2222-4222-8222-222222222222";
    const body = [
      `[Current](context-use://document/${targetId})`,
      `[Legacy duplicate](context-use://page/${targetId})`,
    ].join("\n\n");
    const metadata = markdownObjectMetadata(revisionId, body);
    const revision: UnindexedDocumentRevision = {
      revision_id: revisionId,
      ...metadata,
    };
    let pending = true;
    const replacements: Array<{ revisionId: string; targetIds: string[] }> = [];
    await storage.write({
      id: revisionId,
      objectKey: metadata.body_object_key,
      filename: `${revisionId}.md`,
      contentType: "text/markdown; charset=utf-8",
      sizeBytes: metadata.body_size_bytes,
      contentHash: metadata.body_content_hash,
    }, new Blob([body]).stream());
    const maintenance: Pick<DocumentMaintenanceRepository,
      "unindexedLinkRevisions" | "replaceRevisionLinks" | "deferRevisionLinks"> = {
      async unindexedLinkRevisions() {
        return pending ? [revision] : [];
      },
      async replaceRevisionLinks(sourceRevisionId, targetDocumentIds) {
        replacements.push({ revisionId: sourceRevisionId, targetIds: targetDocumentIds });
        pending = false;
      },
      async deferRevisionLinks() {
        throw new Error("A valid revision must not be deferred");
      },
    };

    expect(await reconcileDocumentLinks({ storage, maintenance })).toEqual({
      indexed: 1,
      failures: [],
    });

    expect(replacements).toEqual([{ revisionId, targetIds: [targetId] }]);
  });

  test("defers missing or corrupt revisions while indexing later available bodies", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-use-document-link-failures-"));
    temporaryRoots.push(root);
    const storage = new FilesystemStorage(root);
    const missingId = "11111111-1111-4111-8111-111111111111";
    const corruptId = "22222222-2222-4222-8222-222222222222";
    const validId = "33333333-3333-4333-8333-333333333333";
    const targetId = "44444444-4444-4444-8444-444444444444";
    const missing = { revision_id: missingId, ...markdownObjectMetadata(missingId, "missing") };
    const corrupt = { revision_id: corruptId, ...markdownObjectMetadata(corruptId, "expected") };
    const validBody = `[Target](context-use://document/${targetId})`;
    const valid = { revision_id: validId, ...markdownObjectMetadata(validId, validBody) };
    const actualCorrupt = markdownObjectMetadata(corruptId, "corrupt!");
    await storage.write({
      id: corruptId,
      objectKey: actualCorrupt.body_object_key,
      filename: `${corruptId}.md`,
      contentType: "text/markdown; charset=utf-8",
      sizeBytes: actualCorrupt.body_size_bytes,
      contentHash: actualCorrupt.body_content_hash,
    }, new Blob(["corrupt!"]).stream());
    await storage.write({
      id: validId,
      objectKey: valid.body_object_key,
      filename: `${validId}.md`,
      contentType: "text/markdown; charset=utf-8",
      sizeBytes: valid.body_size_bytes,
      contentHash: valid.body_content_hash,
    }, new Blob([validBody]).stream());

    const deferred: string[] = [];
    const replacements: Array<{ revisionId: string; targetIds: string[] }> = [];
    const maintenance: Pick<DocumentMaintenanceRepository,
      "unindexedLinkRevisions" | "replaceRevisionLinks" | "deferRevisionLinks"> = {
      async unindexedLinkRevisions() {
        return [missing, corrupt, valid];
      },
      async replaceRevisionLinks(revisionId, targetIds) {
        replacements.push({ revisionId, targetIds });
      },
      async deferRevisionLinks(revisionId) {
        deferred.push(revisionId);
      },
    };

    const result = await reconcileDocumentLinks({ storage, maintenance });

    expect(result.indexed).toBe(1);
    expect(result.failures.map(({ revisionId }) => revisionId).sort())
      .toEqual([corruptId, missingId].sort());
    expect(deferred.sort()).toEqual([corruptId, missingId].sort());
    expect(replacements).toEqual([{ revisionId: validId, targetIds: [targetId] }]);
  });

  test("bounds link-index bodies by concurrent count and declared bytes", async () => {
    const mib = 1024 * 1024;
    const declaredSizes = [
      ...Array.from({ length: 10 }, () => 1),
      ...Array.from({ length: 5 }, () => 4 * mib),
      20 * mib,
      4 * mib,
    ];
    const revisions = declaredSizes.map((body_size_bytes, index) => {
      const revisionId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      return {
        revision_id: revisionId,
        body_object_key: `documents/private/${revisionId}.md`,
        body_size_bytes,
        body_content_hash: "a".repeat(64),
      };
    });
    const sizesByKey = new Map(revisions.map((revision) => [
      revision.body_object_key,
      revision.body_size_bytes,
    ]));
    const sizesByRevision = new Map(revisions.map((revision) => [
      revision.revision_id,
      revision.body_size_bytes,
    ]));
    let activeCount = 0;
    let activeBytes = 0;
    let maxActiveCount = 0;
    let maxConcurrentBytes = 0;
    const oversizedConcurrency: number[] = [];
    const storage = {
      async verify() {
        return true;
      },
      async read(objectKey: string) {
        const size = sizesByKey.get(objectKey)!;
        activeCount += 1;
        activeBytes += size;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        if (activeCount > 1) maxConcurrentBytes = Math.max(maxConcurrentBytes, activeBytes);
        if (size > 16 * mib) oversizedConcurrency.push(activeCount);
        return new Blob(["No links."]);
      },
    } as unknown as ObjectStorageBackend;
    const maintenance: Pick<DocumentMaintenanceRepository,
      "unindexedLinkRevisions" | "replaceRevisionLinks" | "deferRevisionLinks"> = {
      async unindexedLinkRevisions() {
        return revisions;
      },
      async replaceRevisionLinks(revisionId) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeCount -= 1;
        activeBytes -= sizesByRevision.get(revisionId)!;
      },
      async deferRevisionLinks() {
        throw new Error("Every synthetic revision should index successfully");
      },
    };

    expect(await reconcileDocumentLinks({ storage, maintenance })).toEqual({
      indexed: revisions.length,
      failures: [],
    });
    expect(maxActiveCount).toBeLessThanOrEqual(8);
    expect(maxConcurrentBytes).toBeLessThanOrEqual(16 * mib);
    expect(oversizedConcurrency).toEqual([1]);
  });

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
