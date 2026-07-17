import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { AssetIntegrityError, FilesystemStorage, type StoredAsset } from "./storage.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "context-use-assets-"));
  temporaryDirectories.push(root);
  const asset: StoredAsset = {
    id: "11111111-1111-4111-8111-111111111111",
    objectKey: "objects/11111111-1111-4111-8111-111111111111",
    filename: "document.pdf",
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
  return { root, asset, storage: new FilesystemStorage(root) };
}

describe("application-routed asset storage", () => {
  test("writes verified bytes without buffering them in the route", async () => {
    const bytes = new TextEncoder().encode("a private PDF");
    const { root, asset, storage } = await fixture(bytes);

    await storage.write(asset, new Blob([bytes]).stream());

    expect(await Bun.file(join(root, asset.objectKey)).bytes()).toEqual(bytes);
    expect(await storage.verify(asset.objectKey, asset.sizeBytes, asset.contentHash)).toBe(true);
  });

  test("rejects checksum mismatches and never promotes the temporary file", async () => {
    const expected = new TextEncoder().encode("expected bytes");
    const supplied = new TextEncoder().encode("tampered bytes");
    const { root, asset, storage } = await fixture(expected);

    await expect(storage.write(asset, new Blob([supplied]).stream())).rejects.toBeInstanceOf(AssetIntegrityError);
    expect(await Bun.file(join(root, asset.objectKey)).exists()).toBe(false);
  });

  test("rejects truncated uploads", async () => {
    const expected = new TextEncoder().encode("complete bytes");
    const supplied = expected.slice(0, 4);
    const { root, asset, storage } = await fixture(expected);

    await expect(storage.write(asset, new Blob([supplied]).stream())).rejects.toBeInstanceOf(AssetIntegrityError);
    expect(await Bun.file(join(root, asset.objectKey)).exists()).toBe(false);
  });
});
