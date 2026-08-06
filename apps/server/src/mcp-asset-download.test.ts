import { describe, expect, test } from "bun:test";
import type { AssetRepository } from "@context-use/database";
import { createAssetCapability, verifyAssetCapability } from "./mcp-asset-capability.ts";
import { createMcpAssetDownloadHandler } from "./mcp-asset-download.ts";
import type { ByteRange, ObjectStorage } from "./storage.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode("private asset bytes");
const principal = { clientId: "mcp-client", sessionId: "mcp-session" };

function fixture() {
  const asset = {
    id: assetId,
    current_path: "documents/private-asset",
    filename: "private.pdf",
    content_type: "application/pdf",
    size_bytes: bytes.byteLength,
    content_hash: "a".repeat(64),
    s3_object_key: `objects/${assetId}`,
  };
  const assets = {
    async get(id: string, includeObjectKey: boolean) {
      return id === assetId && includeObjectKey ? asset : null;
    },
  } as unknown as AssetRepository;
  const reads: Array<{ objectKey: string; range?: ByteRange }> = [];
  const storage = {
    async read(objectKey: string, range?: ByteRange) {
      reads.push({ objectKey, ...(range ? { range } : {}) });
      return new Blob([range ? bytes.slice(range.start, range.end + 1) : bytes]);
    },
  } as unknown as ObjectStorage;
  const handler = createMcpAssetDownloadHandler(assets, storage, async () => true);
  return { handler, reads };
}

function downloadRequest(token: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/mcp/assets/${assetId}/content`, {
    headers: { "x-context-use-download-token": token, ...headers },
  });
}

describe("MCP asset download capabilities", () => {
  test("signs an asset-specific capability with a fixed expiry", () => {
    const now = Date.UTC(2026, 6, 18, 12, 0, 0);
    const created = createAssetCapability("download", assetId, principal, now);
    expect(created.expiresAt).toBe("2026-07-18T12:05:00.000Z");
    expect(verifyAssetCapability(created.token, "download", now)).toMatchObject({
      assetId,
      action: "download",
      ...principal,
    });
    expect(verifyAssetCapability(created.token, "download", now + 5 * 60 * 1000)).toBeNull();
    expect(verifyAssetCapability(`${created.token}tampered`, "download", now)).toBeNull();
  });

  test("streams bytes for an action- and asset-bound capability", async () => {
    const capability = createAssetCapability("download", assetId, principal);
    const { handler, reads } = fixture();
    const response = await handler(downloadRequest(capability.token, { range: "bytes=0-6" }), assetId);

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("private");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="private.pdf"');
    expect(reads).toEqual([{ objectKey: `objects/${assetId}`, range: { start: 0, end: 6 } }]);
  });

  test("rejects another asset and an upload capability", async () => {
    const otherAsset = "22222222-2222-4222-8222-222222222222";
    const wrongAsset = createAssetCapability("download", otherAsset, principal);
    expect((await fixture().handler(downloadRequest(wrongAsset.token), assetId)).status).toBe(401);

    const upload = createAssetCapability("upload", assetId, principal);
    expect((await fixture().handler(downloadRequest(upload.token), assetId)).status).toBe(401);
  });

  test("does not accept cookies or OAuth bearer credentials on the capability route", async () => {
    const capability = createAssetCapability("download", assetId, principal);
    expect((await fixture().handler(downloadRequest(capability.token, { cookie: "session=forged" }), assetId)).status).toBe(401);
    expect((await fixture().handler(downloadRequest(capability.token, { authorization: "Bearer oauth-token" }), assetId)).status).toBe(401);
  });

  test("does not accept the capability on another origin", async () => {
    const capability = createAssetCapability("download", assetId, principal);
    const request = new Request(`https://assets.example.com/api/mcp/assets/${assetId}/content`, {
      headers: { "x-context-use-download-token": capability.token },
    });
    expect((await fixture().handler(request, assetId)).status).toBe(401);
  });

  test("rejects a signed capability after its MCP lineage is revoked", async () => {
    const capability = createAssetCapability("download", assetId, principal);
    const revoked = createMcpAssetDownloadHandler({} as AssetRepository, {} as ObjectStorage, async () => false);

    expect((await revoked(downloadRequest(capability.token), assetId)).status).toBe(401);
  });
});
