import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { RestorableKnowledgeRecords } from "@context-use/database";
import {
  InvalidKnowledgeArchiveError,
  readRestorableKnowledgeArchive,
  streamRestorableKnowledgeArchive,
  validateRestorableKnowledgeRecords,
} from "./knowledge-archive.ts";
import type { ObjectStorage } from "./storage.ts";

const rootId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const assetId = "00000000-0000-4000-8000-000000000004";
const deletedAssetId = "00000000-0000-4000-8000-000000000005";
const timestamp = "2026-08-13 10:11:12.123456+00";
const assetBytes = new TextEncoder().encode("full archive asset");
const assetHash = createHash("sha256").update(assetBytes).digest("hex");

function records(): RestorableKnowledgeRecords {
  return {
    directories: [{
      id: rootId,
      current_path: "",
      version_number: 3,
      title: "Knowledge",
      summary: "Owner knowledge",
      created_at: timestamp,
      updated_at: timestamp,
    }],
    pages: [{
      id: pageId,
      current_path: "agents",
      current_version_id: versionId,
      published_version_id: versionId,
      public_path: "agents",
      created_at: timestamp,
      updated_at: timestamp,
      archived_at: null,
    }],
    page_versions: [{
      id: versionId,
      page_id: pageId,
      version_number: 7,
      path: "agents",
      title: "AGENTS.md",
      summary: "Root guide",
      body_markdown: `Keep [the asset](context-use://asset/${assetId}).`,
      commit_message: "Preserve exact context",
      actor_kind: "mcp",
      actor_subject: "source-agent",
      created_at: timestamp,
    }],
    assets: [{
      id: assetId,
      current_path: "files/archive.txt",
      public_path: "files/archive.txt",
      filename: "archive.txt",
      content_type: "text/plain",
      size_bytes: String(assetBytes.byteLength),
      content_hash: assetHash,
      s3_object_key: `objects/${assetId}`,
      width: null,
      height: null,
      duration_seconds: null,
      created_at: timestamp,
      deleted_at: null,
    }, {
      id: deletedAssetId,
      current_path: "files/old.txt",
      public_path: null,
      filename: "old.txt",
      content_type: "text/plain",
      size_bytes: "9",
      content_hash: "a".repeat(64),
      s3_object_key: `objects/${deletedAssetId}`,
      width: null,
      height: null,
      duration_seconds: null,
      created_at: timestamp,
      deleted_at: timestamp,
    }],
    asset_links: [{ source_version_id: versionId, target_asset_id: assetId, created_at: timestamp }],
    page_changes: [{
      change_sequence: "42",
      page_id: pageId,
      version_id: versionId,
      version_number: 7,
      change_kind: "updated",
      path: "agents",
      title: "AGENTS.md",
      commit_message: "Preserve exact context",
      actor_kind: "mcp",
      actor_subject: "source-agent",
      changed_at: timestamp,
    }],
  };
}

const storage: ObjectStorage = {
  async read(objectKey) {
    if (objectKey !== `objects/${assetId}`) throw new Error("unexpected asset read");
    return new Blob([assetBytes]);
  },
  async write() {},
  async delete() {},
  async verify() { return true; },
};

describe("restorable knowledge archives", () => {
  test("round-trips canonical records and only active asset bytes", async () => {
    const archive = await new Response(streamRestorableKnowledgeArchive(records(), storage)).blob();
    const staged = new Map<string, Uint8Array>();
    const parsed = await readRestorableKnowledgeArchive(archive.stream(), async (asset, body) => {
      staged.set(asset.id, new Uint8Array(await new Response(body).arrayBuffer()));
    });

    expect(parsed.records).toEqual(records());
    expect(parsed.manifest.counts).toEqual({
      directories: 1,
      pages: 1,
      page_versions: 1,
      assets: 2,
      active_assets: 1,
      asset_links: 1,
      page_changes: 1,
    });
    expect(staged.get(assetId)).toEqual(assetBytes);
    expect(staged.has(deletedAssetId)).toBeFalse();
  });

  test("rejects page projections whose current version is missing", () => {
    const invalid = records();
    invalid.pages[0]!.current_version_id = "00000000-0000-4000-8000-000000000099";
    expect(() => validateRestorableKnowledgeRecords(invalid)).toThrow("invalid current version");
  });

  test("rejects archives with an extra root-guide projection", () => {
    const invalid = records();
    const duplicateVersionId = "00000000-0000-4000-8000-000000000098";
    invalid.page_versions.push({
      ...invalid.page_versions[0]!,
      id: duplicateVersionId,
      page_id: "00000000-0000-4000-8000-000000000099",
    });
    invalid.pages.push({
      ...invalid.pages[0]!,
      id: "00000000-0000-4000-8000-000000000099",
      current_version_id: duplicateVersionId,
      published_version_id: null,
      public_path: null,
      archived_at: timestamp,
    });
    expect(() => validateRestorableKnowledgeRecords(invalid)).toThrow("exactly one active root AGENTS.md page");
  });

  test("classifies malformed ZIP input as an archive validation error", async () => {
    await expect(readRestorableKnowledgeArchive(
      new Blob(["not a zip"]).stream(),
      async () => undefined,
    )).rejects.toBeInstanceOf(InvalidKnowledgeArchiveError);
  });

  test("reports staging progress and leaves no spooled archive behind", async () => {
    const spoolDirectory = await mkdtemp(join(tmpdir(), "import-spool-"));
    try {
      const archive = await new Response(streamRestorableKnowledgeArchive(records(), storage)).blob();
      const progress: Array<[number, number]> = [];
      await readRestorableKnowledgeArchive(
        archive.stream(),
        async (_asset, body) => { await new Response(body).arrayBuffer(); },
        { spoolDirectory, onProgress: (staged, total) => progress.push([staged, total]) },
      );
      expect(progress).toEqual([[1, 1]]);
      expect(await readdir(spoolDirectory)).toEqual([]);
    } finally {
      await rm(spoolDirectory, { recursive: true, force: true });
    }
  });

  test("discards the spooled archive when staging fails", async () => {
    const spoolDirectory = await mkdtemp(join(tmpdir(), "import-spool-"));
    try {
      const archive = await new Response(streamRestorableKnowledgeArchive(records(), storage)).blob();
      await expect(readRestorableKnowledgeArchive(
        archive.stream(),
        async () => { throw new Error("staging backend is unavailable"); },
        { spoolDirectory },
      )).rejects.toThrow("staging backend is unavailable");
      expect(await readdir(spoolDirectory)).toEqual([]);
    } finally {
      await rm(spoolDirectory, { recursive: true, force: true });
    }
  });
});
