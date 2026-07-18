import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { AssetRepository } from "@context-use/database";
import {
  createAssetUploadCapability,
  createMcpAssetUploadHandler,
  verifyAssetUploadCapability,
} from "./mcp-asset-upload.ts";
import type { ObjectStorage, StoredAsset } from "./storage.ts";

const assetId = "11111111-1111-4111-8111-111111111111";
const bytes = new TextEncoder().encode("private asset bytes");
const contentHash = createHash("sha256").update(bytes).digest("hex");

function fixture(grantActive = true) {
  const asset = {
    id: assetId,
    current_path: "documents/private-asset",
    filename: "private.pdf",
    content_type: "application/pdf",
    size_bytes: bytes.byteLength,
    content_hash: contentHash,
    s3_object_key: `objects/${assetId}`,
  };
  let written: { asset: StoredAsset; bytes: Uint8Array } | null = null;
  const assets = {
    async get(id: string, includeObjectKey: boolean) {
      return id === assetId && includeObjectKey ? asset : null;
    },
  } as unknown as AssetRepository;
  const storage = {
    async write(storedAsset: StoredAsset, body: ReadableStream<Uint8Array> | null) {
      written = { asset: storedAsset, bytes: new Uint8Array(await new Response(body).arrayBuffer()) };
    },
  } as unknown as ObjectStorage;
  const grantChecks: unknown[] = [];
  const handler = createMcpAssetUploadHandler(assets, storage, async (clientId, userId, scopes) => {
    grantChecks.push({ clientId, userId, scopes: [...scopes] });
    return grantActive;
  });
  return { handler, grantChecks, written: () => written };
}

function uploadRequest(token: string, body: Uint8Array = bytes, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/mcp/assets/${assetId}/content`, {
    method: "PUT",
    headers: {
      "content-type": "application/pdf",
      "content-length": String(body.byteLength),
      "x-context-use-upload-token": token,
      ...headers,
    },
    body: new Blob([new Uint8Array(body).buffer]),
  });
}

describe("MCP asset upload capabilities", () => {
  test("signs an asset-specific capability with a fixed expiry", () => {
    const now = Date.UTC(2026, 6, 18, 12, 0, 0);
    const created = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" }, now);
    expect(created.expiresAt).toBe("2026-07-18T12:15:00.000Z");
    expect(verifyAssetUploadCapability(created.token, now)).toMatchObject({
      assetId,
      clientId: "mcp-client",
      userId: "owner",
    });
    expect(verifyAssetUploadCapability(created.token, now + 15 * 60 * 1000)).toBeNull();
    expect(verifyAssetUploadCapability(`${created.token}tampered`, now)).toBeNull();
  });

  test("streams exact bytes after rechecking the live asset-write grant", async () => {
    const capability = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    const { handler, grantChecks, written } = fixture();

    const response = await handler(uploadRequest(capability.token), assetId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uploaded: true, asset_id: assetId });
    expect(grantChecks).toEqual([{ clientId: "mcp-client", userId: "owner", scopes: ["assets:write"] }]);
    expect(written()).toMatchObject({ asset: { id: assetId, contentHash } });
    expect(written()?.bytes).toEqual(bytes);
  });

  test("rejects credentials for another asset, inactive grants, and mismatched metadata", async () => {
    const otherAsset = "22222222-2222-4222-8222-222222222222";
    const capability = createAssetUploadCapability({ assetId: otherAsset, clientId: "mcp-client", userId: "owner" });
    expect((await fixture().handler(uploadRequest(capability.token), assetId)).status).toBe(401);

    const correct = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    expect((await fixture(false).handler(uploadRequest(correct.token), assetId)).status).toBe(401);
    expect((await fixture().handler(uploadRequest(correct.token, bytes, { "content-type": "text/plain" }), assetId)).status).toBe(422);
    expect((await fixture().handler(uploadRequest(correct.token, bytes, { "content-length": "1" }), assetId)).status).toBe(422);
  });

  test("does not accept cookies or OAuth bearer credentials on the capability route", async () => {
    const capability = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    expect((await fixture().handler(uploadRequest(capability.token, bytes, { cookie: "session=forged" }), assetId)).status).toBe(401);
    expect((await fixture().handler(uploadRequest(capability.token, bytes, { authorization: "Bearer oauth-token" }), assetId)).status).toBe(401);
  });

  test("does not accept the capability on another origin", async () => {
    const capability = createAssetUploadCapability({ assetId, clientId: "mcp-client", userId: "owner" });
    const request = new Request(`https://assets.example.com/api/mcp/assets/${assetId}/content`, {
      method: "PUT",
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "x-context-use-upload-token": capability.token,
      },
      body: new Blob([bytes.buffer]),
    });
    expect((await fixture().handler(request, assetId)).status).toBe(401);
  });
});
