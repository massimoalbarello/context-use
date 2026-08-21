import type { ByteRange, GeneratedObjectMetadata, ObjectStorage, StoredAsset } from "./storage.ts";
import { AssetNotFoundError } from "./storage.ts";

type StorageClientOptions = {
  socketPath: string;
  token: string;
  publicOnly?: boolean;
};

async function socketFetch(
  socketPath: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: ReadableStream<Uint8Array> | null } = {},
): Promise<Response> {
  const requestInit = {
    method: init.method ?? "GET",
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body as BodyInit | null } : {}),
  };
  const local = (globalThis as typeof globalThis & {
    __contextUseStorageHandler?: (request: Request) => Promise<Response> | Response;
  }).__contextUseStorageHandler;
  return local
    ? local(new Request(`http://context-use-storage${path}`, requestInit))
    : fetch(`http://localhost${path}`, { unix: socketPath, ...requestInit });
}

export class BrokeredStorage implements ObjectStorage {
  constructor(private readonly options: StorageClientOptions) {}

  private async request(path: string, init: Parameters<typeof socketFetch>[2] = {}): Promise<Response> {
    return socketFetch(this.options.socketPath, path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request("/private/object", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(asset.sizeBytes),
        "x-asset-id": asset.id,
        "x-object-key": asset.objectKey,
        "x-filename": encodeURIComponent(asset.filename),
        "x-content-type": asset.contentType,
        "x-content-sha256": asset.contentHash,
      },
      body,
    });
    if (!response.ok) throw new Error(`Storage write failed (${response.status})`);
  }

  async writeDocument(input: {
    revisionId: string;
    objectKey: string;
    sizeBytes: number;
    contentHash: string;
    body: string;
  }): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request("/private/document", {
      method: "PUT",
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-length": String(input.sizeBytes),
        "x-document-revision-id": input.revisionId,
        "x-object-key": input.objectKey,
        "x-content-sha256": input.contentHash,
      },
      body: new Blob([input.body]).stream(),
    });
    if (!response.ok) throw new Error(`Knowledge document write failed (${response.status})`);
  }

  async readDocument(objectKey: string): Promise<string> {
    if (this.options.publicOnly) throw new Error("Private knowledge is unavailable");
    const response = await this.request(`/private/document?key=${encodeURIComponent(objectKey)}`);
    if (response.status === 404) throw new AssetNotFoundError();
    if (!response.ok) throw new Error(`Knowledge document read failed (${response.status})`);
    return response.text();
  }

  async readPublishedDocument(publicPath: string): Promise<string> {
    if (!this.options.publicOnly) throw new Error("Published document reads require a public-only client");
    const response = await this.request(`/public/document?path=${encodeURIComponent(publicPath)}`);
    if (response.status === 404) throw new AssetNotFoundError();
    if (!response.ok) throw new Error(`Published document read failed (${response.status})`);
    return response.text();
  }

  async delete(objectKey: string): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/object?key=${encodeURIComponent(objectKey)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Storage deletion failed (${response.status})`);
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    // Public callers pass an already-public knowledge path; only the broker can
    // translate it into an object key. Private callers continue to pass the
    // immutable object key selected by their private metadata repository.
    const query = this.options.publicOnly
      ? `/public/object?path=${encodeURIComponent(objectKey)}`
      : objectKey.startsWith("exports/")
        ? `/private/export?key=${encodeURIComponent(objectKey)}`
        : `/private/object?key=${encodeURIComponent(objectKey)}`;
    const response = await this.request(query, {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    if (response.status === 404) throw new AssetNotFoundError();
    if (!response.ok || !response.body) throw new Error(`Storage read failed (${response.status})`);
    return response.body;
  }

  async writeGenerated(
    objectKey: string,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<GeneratedObjectMetadata> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/export?key=${encodeURIComponent(objectKey)}`, {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body,
    });
    if (!response.ok) throw new Error(`Generated storage write failed (${response.status})`);
    const result = await response.json() as { size_bytes?: unknown; content_hash?: unknown };
    if (!Number.isSafeInteger(result.size_bytes) || Number(result.size_bytes) <= 0
        || typeof result.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(result.content_hash)) {
      throw new Error("Generated storage returned invalid metadata");
    }
    return { sizeBytes: Number(result.size_bytes), contentHash: result.content_hash };
  }

  async inspectGenerated(objectKey: string): Promise<GeneratedObjectMetadata | null> {
    if (this.options.publicOnly) return null;
    const response = await this.request(`/private/export?key=${encodeURIComponent(objectKey)}`, { method: "HEAD" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Generated storage inspection failed (${response.status})`);
    const sizeBytes = Number(response.headers.get("content-length"));
    const contentHash = response.headers.get("x-content-sha256") ?? "";
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || !/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new Error("Generated storage returned invalid metadata");
    }
    return { sizeBytes, contentHash };
  }

  async deleteGenerated(objectKey: string): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/export?key=${encodeURIComponent(objectKey)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Generated storage deletion failed (${response.status})`);
  }

  async stageImport(intentId: string, asset: StoredAsset, body: ReadableStream<Uint8Array>): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/import-stage?intent=${encodeURIComponent(intentId)}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(asset.sizeBytes),
        "x-asset-id": asset.id,
        "x-filename": encodeURIComponent(asset.filename),
        "x-content-type": asset.contentType,
        "x-content-sha256": asset.contentHash,
      },
      body,
    });
    if (!response.ok) throw new Error(`Import staging failed (${response.status})`);
  }

  async promoteImport(intentId: string, asset: StoredAsset): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/import-promote?intent=${encodeURIComponent(intentId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-asset-id": asset.id,
        "x-filename": encodeURIComponent(asset.filename),
        "x-content-type": asset.contentType,
        "x-content-length": String(asset.sizeBytes),
        "x-content-sha256": asset.contentHash,
      },
      body: new Blob(["{}"]).stream(),
    });
    if (!response.ok) throw new Error(`Import asset promotion failed (${response.status})`);
  }

  async cleanupImport(intentId: string, assetId: string): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(
      `/private/import?intent=${encodeURIComponent(intentId)}&asset=${encodeURIComponent(assetId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) throw new Error(`Import cleanup failed (${response.status})`);
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    if (this.options.publicOnly) return false;
    const response = await this.request("/private/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Blob([JSON.stringify({ object_key: objectKey, size_bytes: sizeBytes, content_hash: contentHash })]).stream(),
    });
    if (!response.ok) return false;
    const result = await response.json() as { verified?: boolean };
    return result.verified === true;
  }
}
