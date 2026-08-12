import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, test } from "bun:test";
import { AssetIntegrityError, credentialsFromFile, FilesystemStorage, mayRenderInline, S3Storage, type StoredAsset } from "./storage.ts";

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

function generatedZipBytes(sizeBytes: number): Buffer<ArrayBuffer> {
  if (sizeBytes < 22) throw new Error("ZIP fixture is too small");
  const bytes = Buffer.alloc(sizeBytes, 17);
  const footer = sizeBytes - 22;
  bytes.set([0x50, 0x4b, 0x05, 0x06], footer);
  bytes.fill(0, footer + 4);
  return bytes;
}

class FakeS3Client {
  readonly partLengths: number[] = [];
  readonly uploadedParts = new Map<number, Uint8Array>();
  object: Uint8Array | null = null;
  metadata: Record<string, string> | undefined;
  readonly auxiliaryObjects = new Map<string, Uint8Array>();
  aborted = false;

  async send(command: unknown): Promise<Record<string, unknown>> {
    if (command instanceof PutObjectCommand) {
      const body = command.input.Body;
      const bytes = typeof body === "string" ? Buffer.from(body) : body;
      if (!(bytes instanceof Uint8Array)) throw new Error("PutObject body was not buffered bytes");
      if (command.input.Key?.endsWith(".json")) {
        this.auxiliaryObjects.set(command.input.Key, new Uint8Array(bytes));
        return {};
      }
      this.object = new Uint8Array(bytes);
      this.metadata = command.input.Metadata;
      return {};
    }
    if (command instanceof CreateMultipartUploadCommand) {
      this.metadata = command.input.Metadata;
      return { UploadId: "test-upload" };
    }
    if (command instanceof UploadPartCommand) {
      const body = command.input.Body;
      if (!(body instanceof Uint8Array)) throw new Error("UploadPart body was not buffered bytes");
      this.partLengths.push(body.byteLength);
      this.uploadedParts.set(command.input.PartNumber!, new Uint8Array(body));
      return { ETag: `etag-${command.input.PartNumber}` };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      this.object = Buffer.concat(
        [...this.uploadedParts.entries()].sort(([left], [right]) => left - right).map(([, bytes]) => bytes),
      );
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      this.aborted = true;
      this.uploadedParts.clear();
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      return {
        ContentLength: this.object?.byteLength,
        Metadata: this.metadata,
      };
    }
    if (command instanceof GetObjectCommand) {
      const auxiliary = this.auxiliaryObjects.get(command.input.Key!);
      if (auxiliary) {
        return { Body: { transformToString: async () => Buffer.from(auxiliary).toString() } };
      }
      let bytes = this.object;
      if (!bytes) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      const match = command.input.Range?.match(/^bytes=(\d+)-(\d+)$/);
      if (match) bytes = bytes.slice(Number(match[1]), Number(match[2]) + 1);
      return { Body: { transformToByteArray: async () => bytes! } };
    }
    if (command instanceof DeleteObjectCommand) {
      if (command.input.Key?.endsWith(".json")) this.auxiliaryObjects.delete(command.input.Key);
      else this.object = null;
      return {};
    }
    throw new Error(`Unexpected S3 command: ${String(command)}`);
  }
}

describe("application-routed asset storage", () => {
  test("loads only unexpired scoped process credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "context-use-credentials-"));
    temporaryDirectories.push(root);
    const path = join(root, "credentials.json");
    await Bun.write(path, JSON.stringify({
      Version: 1,
      AccessKeyId: "ASIAEXAMPLEACCESSKEY",
      SecretAccessKey: "example-secret-access-key-that-is-long-enough",
      SessionToken: "example-session-token-that-is-long-enough",
      Expiration: new Date(Date.now() + 60_000).toISOString(),
    }));
    expect(await credentialsFromFile(path)()).toMatchObject({
      accessKeyId: "ASIAEXAMPLEACCESSKEY",
      sessionToken: "example-session-token-that-is-long-enough",
    });

    await Bun.write(path, JSON.stringify({
      Version: 1,
      AccessKeyId: "ASIAEXAMPLEACCESSKEY",
      SecretAccessKey: "example-secret-access-key-that-is-long-enough",
      SessionToken: "example-session-token-that-is-long-enough",
      Expiration: new Date(Date.now() - 1).toISOString(),
    }));
    await expect(credentialsFromFile(path)()).rejects.toThrow("expired");
  });

  test("inlines browser-viewable formats without allowing active images", () => {
    expect(mayRenderInline("image/avif")).toBe(true);
    expect(mayRenderInline("video/quicktime")).toBe(true);
    expect(mayRenderInline("application/pdf")).toBe(true);
    expect(mayRenderInline("text/html")).toBe(true);
    expect(mayRenderInline("image/svg+xml")).toBe(false);
  });

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

  test("commits generated filesystem objects only with a matching manifest", async () => {
    const bytes = generatedZipBytes(128);
    const { root, storage } = await fixture(bytes);
    const key = "exports/11111111-1111-4111-8111-111111111111.zip";

    const written = await storage.writeGenerated(key, new Blob([bytes]).stream());

    expect(written).toEqual({
      sizeBytes: bytes.byteLength,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await storage.inspectGenerated(key)).toEqual(written);
    expect(await Bun.file(join(root, key)).bytes()).toEqual(bytes);
    await storage.deleteGenerated(key);
    expect(await storage.inspectGenerated(key)).toBeNull();
  });

  test("does not commit a generated object without a finalized ZIP directory", async () => {
    const bytes = Buffer.alloc(128, 17);
    const { root, storage } = await fixture(bytes);
    const key = "exports/11111111-1111-4111-8111-111111111111.zip";

    await expect(storage.writeGenerated(key, new Blob([bytes]).stream())).rejects.toThrow("not finalized");

    expect(await storage.inspectGenerated(key)).toBeNull();
    expect(await Bun.file(join(root, key)).exists()).toBe(false);
  });

  test("uploads large web request streams as bounded S3 multipart bytes", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 97).fill(42);
    const { asset } = await fixture(bytes);
    const client = new FakeS3Client();
    const storage = new S3Storage(client as unknown as S3Client);

    await storage.write(asset, new Blob([bytes]).stream());

    expect(client.aborted).toBe(false);
    expect(client.partLengths).toEqual([8 * 1024 * 1024, 97]);
    expect(client.object?.byteLength).toBe(bytes.byteLength);
    expect(createHash("sha256").update(client.object!).digest("hex")).toBe(asset.contentHash);
    expect(client.metadata?.sha256).toBe(asset.contentHash);
    expect(await storage.verify(asset.objectKey, asset.sizeBytes, asset.contentHash)).toBe(true);
  });

  test("writes the generated S3 manifest only after multipart completion", async () => {
    const bytes = generatedZipBytes(8 * 1024 * 1024 + 41);
    const key = "exports/11111111-1111-4111-8111-111111111111.zip";
    const client = new FakeS3Client();
    const storage = new S3Storage(client as unknown as S3Client);

    const written = await storage.writeGenerated(key, new Blob([bytes]).stream());

    expect(client.partLengths).toEqual([8 * 1024 * 1024, 41]);
    expect(await storage.inspectGenerated(key)).toEqual(written);
    expect(written.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    await storage.deleteGenerated(key);
    expect(await storage.inspectGenerated(key)).toBeNull();
  });

  test("uploads a large inbound Bun HTTP request without bridging it to a Node stream", async () => {
    const bytes = new Uint8Array(8 * 1024 * 1024 + 113).fill(21);
    const { asset } = await fixture(bytes);
    const client = new FakeS3Client();
    const storage = new S3Storage(client as unknown as S3Client);
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: 5_100_000_000,
      async fetch(request) {
        await storage.write(asset, request.body);
        return Response.json({ uploaded: true });
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/upload`, {
        method: "PUT",
        body: new Blob([bytes]),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ uploaded: true });
      expect(client.partLengths).toEqual([8 * 1024 * 1024, 113]);
      expect(createHash("sha256").update(client.object!).digest("hex")).toBe(asset.contentHash);
    } finally {
      server.stop(true);
    }
  });

  test("aborts multipart uploads before completion when integrity fails", async () => {
    const expected = new Uint8Array(8 * 1024 * 1024 + 1).fill(7);
    const supplied = new Uint8Array(expected.byteLength).fill(8);
    const { asset } = await fixture(expected);
    const client = new FakeS3Client();
    const storage = new S3Storage(client as unknown as S3Client);

    await expect(storage.write(asset, new Blob([supplied]).stream())).rejects.toBeInstanceOf(AssetIntegrityError);

    expect(client.aborted).toBe(true);
    expect(client.object).toBeNull();
  });
});
