import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createStorageBrokerApp } from "./storage-app.ts";
import type { ByteRange, ObjectStorageBackend, StoredAsset } from "./storage.ts";

const tokens = {
  dashboard: "dashboard-token-that-is-long-and-private",
  mcp: "private-mcp-token-that-is-long-and-private",
  public: "public-token-that-is-long-and-private",
};
const publishedKey = "objects/11111111-1111-4111-8111-111111111111";
const privateKey = "objects/22222222-2222-4222-8222-222222222222";
const newKey = "objects/33333333-3333-4333-8333-333333333333";

function privateAssets(
  rows: Record<string, { filename: string; contentType: string; bytes: string }>,
  deletedIds: string[] = [],
) {
  const deleted = new Set(deletedIds);
  return {
    getForStorage: async (id: string) => {
      const row = rows[id];
      if (!row) return null;
      const bytes = Buffer.from(row.bytes);
      return {
        id,
        s3_object_key: `objects/${id}`,
        filename: row.filename,
        content_type: row.contentType,
        size_bytes: bytes.byteLength,
        content_hash: createHash("sha256").update(bytes).digest("hex"),
      };
    },
    getDeletedForStorage: async (id: string) => deleted.has(id)
      ? { id, s3_object_key: `objects/${id}` }
      : null,
  };
}

class MemoryStorage implements ObjectStorageBackend {
  readonly objects = new Map<string, Uint8Array>([
    [publishedKey, Buffer.from("published")],
    [privateKey, Buffer.from("private")],
  ]);

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    this.objects.set(asset.objectKey, new Uint8Array(await new Response(body).arrayBuffer()));
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  async exists(objectKey: string): Promise<boolean> {
    return this.objects.has(objectKey);
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    const bytes = this.objects.get(objectKey);
    if (!bytes) throw new Error("missing");
    const selected = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return new Blob([Buffer.from(selected)]);
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    const bytes = this.objects.get(objectKey);
    return Boolean(bytes && bytes.byteLength === sizeBytes
      && createHash("sha256").update(bytes!).digest("hex") === contentHash);
  }
}

function authorized(token: string, path: string, init: RequestInit = {}): Request {
  return new Request(`http://storage${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

describe("storage broker capabilities", () => {
  test("public capability resolves only an exactly published path without receiving an object key", async () => {
    const storage = new MemoryStorage();
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({}),
      publicAssets: {
        assetByPublicPath: async (path) => path === "public/asset" ? { s3_object_key: publishedKey } : null,
      },
      tokens,
    });

    const published = await app.handle(authorized(tokens.public, "/public/object?path=public%2Fasset"));
    expect(published.status).toBe(200);
    expect(await published.text()).toBe("published");
    expect((await app.handle(authorized(tokens.public, "/public/object?path=private%2Fasset"))).status).toBe(404);
    expect((await app.handle(authorized(tokens.public, `/public/object?key=${publishedKey}`))).status).toBe(404);
    expect((await app.handle(authorized(tokens.public, `/private/object?key=${privateKey}`))).status).toBe(404);
  });

  test("private MCP can read and upload but cannot delete or invoke integrity management", async () => {
    const storage = new MemoryStorage();
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({
        [privateKey.slice("objects/".length)]: {
          filename: "private.txt", contentType: "text/plain", bytes: "private",
        },
        [newKey.slice("objects/".length)]: {
          filename: "new.txt", contentType: "text/plain", bytes: "new",
        },
      }),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });

    expect((await app.handle(authorized(tokens.mcp, `/private/object?key=${privateKey}`))).status).toBe(200);
    const replacement = Buffer.from("changed");
    expect((await app.handle(authorized(tokens.mcp, "/private/object", {
      method: "PUT",
      headers: {
        "content-length": String(replacement.byteLength),
        "x-asset-id": privateKey.slice("objects/".length),
        "x-object-key": privateKey,
        "x-filename": "private.txt",
        "x-content-type": "text/plain",
        "x-content-sha256": createHash("sha256").update(replacement).digest("hex"),
      },
      body: replacement,
    }))).status).toBe(404);
    expect(Buffer.from(storage.objects.get(privateKey)! ).toString()).toBe("private");

    const uploaded = Buffer.from("new");
    expect((await app.handle(authorized(tokens.mcp, "/private/object", {
      method: "PUT",
      headers: {
        "content-length": String(uploaded.byteLength),
        "x-asset-id": newKey.slice("objects/".length),
        "x-object-key": newKey,
        "x-filename": "new.txt",
        "x-content-type": "text/plain",
        "x-content-sha256": createHash("sha256").update(uploaded).digest("hex"),
      },
      body: uploaded,
    }))).status).toBe(204);
    expect(Buffer.from(storage.objects.get(newKey)! ).toString()).toBe("new");
    expect((await app.handle(authorized(tokens.mcp, `/private/object?key=${privateKey}`, { method: "DELETE" }))).status).toBe(404);
    expect(storage.objects.has(privateKey)).toBe(true);
    expect((await app.handle(authorized(tokens.mcp, "/private/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object_key: privateKey, size_bytes: 7, content_hash: "a".repeat(64) }),
    }))).status).toBe(404);
  });

  test("dashboard can delete bytes only after metadata authorizes the lifecycle transition", async () => {
    const storage = new MemoryStorage();
    const privateId = privateKey.slice("objects/".length);
    const publishedId = publishedKey.slice("objects/".length);
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({
        [privateId]: { filename: "private.txt", contentType: "text/plain", bytes: "private" },
        [publishedId]: { filename: "published.txt", contentType: "text/plain", bytes: "published" },
      }, [privateId]),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });

    expect((await app.handle(authorized(tokens.dashboard, `/private/object?key=${publishedKey}`, { method: "DELETE" }))).status).toBe(404);
    expect(storage.objects.has(publishedKey)).toBe(true);
    expect((await app.handle(authorized(tokens.dashboard, `/private/object?key=${privateKey}`, { method: "DELETE" }))).status).toBe(204);
    expect(storage.objects.has(privateKey)).toBe(false);
    expect((await app.handle(authorized("invalid-token-that-is-long-enough-for-parser", `/private/object?key=${publishedKey}`))).status).toBe(404);
  });
});
