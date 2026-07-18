import { describe, expect, test } from "bun:test";
import type { AssetRepository } from "@context-use/database";
import {
  createAssetDownloadCapability,
  createMcpAssetDownloadHandler,
  verifyAssetDownloadCapability,
} from "./mcp-asset-download.ts";
import { createAssetUploadCapability } from "./mcp-asset-upload.ts";
import type { ByteRange, ObjectStorage } from "./storage.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode("private asset bytes");

function fixture(grantActive = true) {
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
  const grantChecks: unknown[] = [];
  const handler = createMcpAssetDownloadHandler(assets, storage, async (clientId, userId, scopes) => {
    grantChecks.push({ clientId, userId, scopes: [...scopes] });
    return grantActive;
  });
  return { handler, grantChecks, reads };
}

function downloadRequest(token: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/mcp/assets/${assetId}/content`, {
    headers: { "x-context-use-download-token": token, ...headers },
  });
}

describe("MCP asset download capabilities", () => {
  test("signs an asset-specific capability with a fixed expiry", () => {
    const now = Date.UTC(2026, 6, 18, 12, 0, 0);
    const created = createAssetDownloadCapability({ assetId, clientId: "mcp-client", userId: "owner" }, now);
    expect(created.expiresAt).toBe("2026-07-18T12:05:00.000Z");
    expect(verifyAssetDownloadCapability(created.token, now)).toMatchObject({
      assetId,
      clientId: "mcp-client",
      userId: "owner",
    });
    expect(verifyAssetDownloadCapability(created.token, now + 5 * 60 * 1000)).toBeNull();
    expect(verifyAssetDownloadCapability(`${created.token}tampered`, now)).toBeNull();
  });

  test("streams bytes only after rechecking the live asset-read grant", async () => {
    const capability = createAssetDownloadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    const { handler, grantChecks, reads } = fixture();
    const response = await handler(downloadRequest(capability.token, { range: "bytes=0-6" }), assetId);

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("private");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="private.pdf"');
    expect(grantChecks).toEqual([{ clientId: "mcp-client", userId: "owner", scopes: ["assets:read"] }]);
    expect(reads).toEqual([{ objectKey: `objects/${assetId}`, range: { start: 0, end: 6 } }]);
  });

  test("rejects another asset, an inactive grant, and an upload capability", async () => {
    const otherAsset = "22222222-2222-4222-8222-222222222222";
    const wrongAsset = createAssetDownloadCapability({ assetId: otherAsset, clientId: "mcp-client", userId: "owner" });
    expect((await fixture().handler(downloadRequest(wrongAsset.token), assetId)).status).toBe(401);

    const correct = createAssetDownloadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    expect((await fixture(false).handler(downloadRequest(correct.token), assetId)).status).toBe(401);

    const upload = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    expect((await fixture().handler(downloadRequest(upload.token), assetId)).status).toBe(401);
  });

  test("does not accept cookies or OAuth bearer credentials on the capability route", async () => {
    const capability = createAssetDownloadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    expect((await fixture().handler(downloadRequest(capability.token, { cookie: "session=forged" }), assetId)).status).toBe(401);
    expect((await fixture().handler(downloadRequest(capability.token, { authorization: "Bearer oauth-token" }), assetId)).status).toBe(401);
  });

  test("does not accept the capability on another origin", async () => {
    const capability = createAssetDownloadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    const request = new Request(`https://assets.example.com/api/mcp/assets/${assetId}/content`, {
      headers: { "x-context-use-download-token": capability.token },
    });
    expect((await fixture().handler(request, assetId)).status).toBe(401);
  });
});
