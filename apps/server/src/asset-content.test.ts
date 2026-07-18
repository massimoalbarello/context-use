import { describe, expect, test } from "bun:test";
import { assetContentResponse, parseAssetRange } from "./asset-content.ts";
import { AssetNotFoundError, type ByteRange, type ObjectStorage } from "./storage.ts";

const bytes = new TextEncoder().encode("0123456789");
const asset = {
  s3_object_key: "objects/private-object",
  filename: "private video.mp4",
  content_type: "video/mp4",
  size_bytes: bytes.byteLength,
};

function storageFixture(missing = false) {
  const reads: Array<{ objectKey: string; range?: ByteRange }> = [];
  const storage = {
    async read(objectKey: string, range?: ByteRange) {
      reads.push({ objectKey, ...(range ? { range } : {}) });
      if (missing) throw new AssetNotFoundError();
      const selected = range ? bytes.slice(range.start, range.end + 1) : bytes;
      return new Blob([selected]);
    },
  } as unknown as ObjectStorage;
  return { storage, reads };
}

describe("API-proxied asset content", () => {
  test("parses only one bounded byte range", () => {
    expect(parseAssetRange(null, 10)).toBeUndefined();
    expect(parseAssetRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseAssetRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseAssetRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseAssetRange("bytes=8-20", 10)).toEqual({ start: 8, end: 9 });
    expect(parseAssetRange("bytes=0-1,4-5", 10)).toBe("unsatisfiable");
    expect(parseAssetRange("bytes=10-", 10)).toBe("unsatisfiable");
  });

  test("streams complete bytes inline without exposing a storage URL", async () => {
    const { storage, reads } = storageFixture();
    const response = await assetContentResponse(
      new Request("https://context.example/api/dashboard/assets/id/content"),
      asset,
      storage,
      true,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="private video.mp4"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(reads).toEqual([{ objectKey: "objects/private-object" }]);
  });

  test("passes range requests to storage for efficient video reads", async () => {
    const { storage, reads } = storageFixture();
    const response = await assetContentResponse(
      new Request("https://context.example/api/dashboard/assets/id/content", {
        headers: { range: "bytes=2-5" },
      }),
      asset,
      storage,
      true,
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("2345");
    expect(reads).toEqual([{ objectKey: "objects/private-object", range: { start: 2, end: 5 } }]);
  });

  test("forces active formats to download and reports missing bytes without a storage redirect", async () => {
    const activeAsset = { ...asset, filename: "unsafe.svg", content_type: "image/svg+xml" };
    const response = await assetContentResponse(
      new Request("https://context.example/api/dashboard/assets/id/content"),
      activeAsset,
      storageFixture().storage,
      true,
    );
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="unsafe.svg"');
    expect(response.headers.has("location")).toBe(false);

    const missing = await assetContentResponse(
      new Request("https://context.example/api/dashboard/assets/id/content"),
      asset,
      storageFixture(true).storage,
      true,
    );
    expect(missing.status).toBe(404);
  });
});
