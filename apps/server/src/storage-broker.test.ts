import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorageBrokerApp } from "./storage-app.ts";
import { BrokeredStorage } from "./storage-client.ts";
import type { ByteRange, GeneratedObjectMetadata, ObjectStorageBackend, StoredAsset } from "./storage.ts";

const tokens = {
  dashboard: "dashboard-token-that-is-long-and-private",
  mcp: "private-mcp-token-that-is-long-and-private",
  public: "public-token-that-is-long-and-private",
};
const publishedKey = "objects/11111111-1111-4111-8111-111111111111";
const privateKey = "objects/22222222-2222-4222-8222-222222222222";
const newKey = "objects/33333333-3333-4333-8333-333333333333";
const exportKey = "exports/44444444-4444-4444-8444-444444444444.zip";

function privateAssets(
  rows: Record<string, { filename: string; contentType: string; bytes: string | Uint8Array }>,
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
  readonly generated = new Map<string, GeneratedObjectMetadata>();

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    this.objects.set(asset.objectKey, new Uint8Array(await new Response(body).arrayBuffer()));
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  async writeGenerated(objectKey: string, body: ReadableStream<Uint8Array> | null): Promise<GeneratedObjectMetadata> {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const metadata = {
      sizeBytes: bytes.byteLength,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    };
    this.objects.set(objectKey, bytes);
    this.generated.set(objectKey, metadata);
    return metadata;
  }

  async inspectGenerated(objectKey: string): Promise<GeneratedObjectMetadata | null> {
    return this.generated.get(objectKey) ?? null;
  }

  async deleteGenerated(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    this.generated.delete(objectKey);
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

  test("knowledge revisions are immutable and public readers resolve only materialized public paths", async () => {
    const storage = new MemoryStorage();
    const revisionId = "66666666-6666-4666-8666-666666666666";
    const privateDocumentKey = `documents/private/${revisionId}.md`;
    const artifactId = "77777777-7777-4777-8777-777777777777";
    const publicDocumentKey = `documents/public/${artifactId}.md`;
    const publicProjection = Buffer.from("public projection");
    storage.objects.set(publicDocumentKey, publicProjection);
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({}),
      publicAssets: {
        assetByPublicPath: async () => null,
        pageByPublicPath: async (path) => path === "public/page"
          ? {
              body_object_key: publicDocumentKey,
              body_size_bytes: publicProjection.byteLength,
              body_content_hash: createHash("sha256").update(publicProjection).digest("hex"),
            }
          : null,
      },
      tokens,
    });
    const markdown = Buffer.from("# Private knowledge\n");
    const headers = {
      "content-length": String(markdown.byteLength),
      "x-document-revision-id": revisionId,
      "x-object-key": privateDocumentKey,
      "x-content-sha256": createHash("sha256").update(markdown).digest("hex"),
    };

    expect((await app.handle(authorized(tokens.mcp, "/private/document", {
      method: "PUT", headers, body: markdown,
    }))).status).toBe(204);
    expect(await (await app.handle(authorized(
      tokens.mcp,
      `/private/document?key=${encodeURIComponent(privateDocumentKey)}`,
    ))).text()).toBe(markdown.toString());
    expect((await app.handle(authorized(
      tokens.public,
      `/private/document?key=${encodeURIComponent(privateDocumentKey)}`,
    ))).status).toBe(404);

    const published = await app.handle(authorized(tokens.public, "/public/document?path=public%2Fpage"));
    expect(await published.text()).toBe("public projection");
    storage.objects.set(publicDocumentKey, Buffer.from("corrupt projection"));
    expect((await app.handle(authorized(tokens.public, "/public/document?path=public%2Fpage"))).status).toBe(404);
    expect((await app.handle(authorized(tokens.public, "/public/document?path=private%2Fpage"))).status).toBe(404);
    expect((await app.handle(authorized(
      tokens.public,
      `/public/document?key=${encodeURIComponent(publicDocumentKey)}`,
    ))).status).toBe(404);
  });

  test("brokered document reads preserve a leading UTF-8 BOM", async () => {
    const storage = new MemoryStorage();
    const revisionId = "88888888-8888-4888-8888-888888888888";
    const objectKey = `documents/private/${revisionId}.md`;
    const markdown = "\uFEFF# BOM-prefixed knowledge\n";
    storage.objects.set(objectKey, Buffer.from(markdown, "utf8"));
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({}),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });
    const directory = await mkdtemp(join(tmpdir(), "context-use-document-bom-"));
    const socketPath = join(directory, "storage.sock");
    const server = Bun.serve({ unix: socketPath, fetch: app.handle });

    try {
      const client = new BrokeredStorage({ socketPath, token: tokens.dashboard });
      const decoded = await client.readDocument(objectKey);
      expect(decoded).toBe(markdown);
      expect(Buffer.from(decoded, "utf8")).toEqual(Buffer.from(markdown, "utf8"));
    } finally {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
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

  test("streams multi-chunk video bytes through the Unix storage broker", async () => {
    const bytes = Uint8Array.from(
      { length: 2 * 1024 * 1024 + 97 },
      (_, index) => (index * 31 + Math.floor(index / 65_536)) % 256,
    );
    const id = newKey.slice("objects/".length);
    const asset: StoredAsset = {
      id,
      objectKey: newKey,
      filename: "demo-video.mp4",
      contentType: "video/mp4",
      sizeBytes: bytes.byteLength,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    };
    const storage = new MemoryStorage();
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({
        [id]: {
          filename: asset.filename,
          contentType: asset.contentType,
          bytes,
        },
      }),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });
    const directory = await mkdtemp(join(tmpdir(), "context-use-storage-broker-"));
    const socketPath = join(directory, "storage.sock");
    const server = Bun.serve({ unix: socketPath, fetch: app.handle });

    try {
      const client = new BrokeredStorage({ socketPath, token: tokens.mcp });
      await client.write(asset, new Blob([bytes]).stream());
      expect(storage.objects.get(newKey)).toEqual(bytes);
    } finally {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
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

  test("only the dashboard can stage and range-read a committed generated export", async () => {
    const storage = new MemoryStorage();
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({}),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });
    const bytes = Buffer.from("complete-knowledge-export");

    expect((await app.handle(authorized(tokens.mcp, `/private/export?key=${encodeURIComponent(exportKey)}`, {
      method: "PUT",
      body: bytes,
    }))).status).toBe(404);
    const staged = await app.handle(authorized(tokens.dashboard, `/private/export?key=${encodeURIComponent(exportKey)}`, {
      method: "PUT",
      body: bytes,
    }));
    expect(staged.status).toBe(201);
    expect(await staged.json()).toEqual({
      size_bytes: bytes.byteLength,
      content_hash: createHash("sha256").update(bytes).digest("hex"),
    });

    const inspected = await app.handle(authorized(tokens.dashboard, `/private/export?key=${encodeURIComponent(exportKey)}`, {
      method: "HEAD",
    }));
    expect(inspected.status).toBe(200);
    expect(inspected.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(inspected.headers.get("accept-ranges")).toBe("bytes");

    const ranged = await app.handle(authorized(tokens.dashboard, `/private/export?key=${encodeURIComponent(exportKey)}`, {
      headers: { range: "bytes=9-17" },
    }));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 9-17/${bytes.byteLength}`);
    expect(await ranged.text()).toBe("knowledge");
    expect((await app.handle(authorized(tokens.mcp, `/private/export?key=${encodeURIComponent(exportKey)}`))).status).toBe(404);

    expect((await app.handle(authorized(tokens.dashboard, `/private/export?key=${encodeURIComponent(exportKey)}`, {
      method: "DELETE",
    }))).status).toBe(204);
    expect(await storage.inspectGenerated(exportKey)).toBeNull();
  });

  test("dashboard storage client round-trips generated metadata and resumable bytes", async () => {
    const storage = new MemoryStorage();
    const app = createStorageBrokerApp({
      storage,
      privateAssets: privateAssets({}),
      publicAssets: { assetByPublicPath: async () => null },
      tokens,
    });
    const directory = await mkdtemp(join(tmpdir(), "context-use-generated-storage-"));
    const socketPath = join(directory, "storage.sock");
    const server = Bun.serve({ unix: socketPath, fetch: app.handle });
    const bytes = Buffer.from("complete-knowledge-export");

    try {
      const client = new BrokeredStorage({ socketPath, token: tokens.dashboard });
      const written = await client.writeGenerated(exportKey, new Blob([bytes]).stream());
      expect(await client.writeGenerated(exportKey, new Blob(["different bytes"]).stream())).toEqual(written);
      expect(await client.inspectGenerated(exportKey)).toEqual(written);
      const ranged = await client.read(exportKey, { start: 9, end: 17 });
      expect(await new Response(ranged).text()).toBe("knowledge");
      await client.deleteGenerated(exportKey);
      expect(await client.inspectGenerated(exportKey)).toBeNull();
    } finally {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
