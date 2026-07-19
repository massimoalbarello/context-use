import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ByteRange, ObjectStorage, StoredAsset } from "./storage.ts";
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
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      socketPath,
      path,
      method: init.method ?? "GET",
      headers: init.headers,
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      resolve(new Response(Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>, {
        status: response.statusCode ?? 500,
        headers,
      }));
    });
    request.on("error", reject);
    if (init.body) {
      Readable.fromWeb(init.body as unknown as NodeReadableStream<Uint8Array>)
        .on("error", reject)
        .pipe(request);
    } else {
      request.end();
    }
  });
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

  async delete(objectKey: string): Promise<void> {
    if (this.options.publicOnly) throw new Error("Published storage is read-only");
    const response = await this.request(`/private/object?key=${encodeURIComponent(objectKey)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`Storage deletion failed (${response.status})`);
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    const prefix = this.options.publicOnly ? "/public/object" : "/private/object";
    const response = await this.request(`${prefix}?key=${encodeURIComponent(objectKey)}`, {
      headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
    });
    if (response.status === 404) throw new AssetNotFoundError();
    if (!response.ok || !response.body) throw new Error(`Storage read failed (${response.status})`);
    return response.body;
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
