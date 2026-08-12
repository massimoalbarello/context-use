import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { isFinalizedZipFooter, zipFooterRange } from "./zip-footer.ts";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

export type StoredAsset = {
  id: string;
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
};

export type ByteRange = { start: number; end: number };

export type GeneratedObjectMetadata = {
  sizeBytes: number;
  contentHash: string;
};

export interface ObjectStorage {
  write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void>;
  delete(objectKey: string): Promise<void>;
  read(objectKey: string, range?: ByteRange): Promise<BodyInit>;
  verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean>;
}

export interface ObjectStorageBackend extends ObjectStorage {
  exists(objectKey: string): Promise<boolean>;
  writeGenerated(objectKey: string, body: ReadableStream<Uint8Array> | null): Promise<GeneratedObjectMetadata>;
  inspectGenerated(objectKey: string): Promise<GeneratedObjectMetadata | null>;
  deleteGenerated(objectKey: string): Promise<void>;
}

export type S3StorageConfig = {
  region: string;
  bucket: string;
  kmsKeyId: string;
};

type ProcessCredentials = {
  Version?: unknown;
  AccessKeyId?: unknown;
  SecretAccessKey?: unknown;
  SessionToken?: unknown;
  Expiration?: unknown;
};

export function credentialsFromFile(path: string) {
  return async () => {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ProcessCredentials;
    if (parsed.Version !== 1
        || typeof parsed.AccessKeyId !== "string" || parsed.AccessKeyId.length<16
        || typeof parsed.SecretAccessKey !== "string" || parsed.SecretAccessKey.length<32
        || typeof parsed.SessionToken !== "string" || parsed.SessionToken.length<16
        || typeof parsed.Expiration !== "string") {
      throw new Error("Scoped AWS credential file is invalid");
    }
    const expiration = new Date(parsed.Expiration);
    if (!Number.isFinite(expiration.getTime()) || expiration.getTime()<=Date.now()) {
      throw new Error("Scoped AWS credential file is expired");
    }
    return {
      accessKeyId: parsed.AccessKeyId,
      secretAccessKey: parsed.SecretAccessKey,
      sessionToken: parsed.SessionToken,
      expiration,
    };
  };
}

export class AssetIntegrityError extends Error {
  constructor(message = "Asset bytes failed integrity verification") {
    super(message);
    this.name = "AssetIntegrityError";
  }
}

export class AssetNotFoundError extends Error {
  constructor(message = "Asset bytes are missing") {
    super(message);
    this.name = "AssetNotFoundError";
  }
}

function nodeStream(body: ReadableStream<Uint8Array> | null): Readable {
  return body
    ? Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>)
    : Readable.from([]);
}

const S3_MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MAX_GENERATED_OBJECT_BYTES = 5 * 1024 ** 3 + 64 * 1024 ** 2;

function generatedManifestKey(objectKey: string): string {
  return `${objectKey}.json`;
}

function parseGeneratedManifest(input: string): GeneratedObjectMetadata | null {
  try {
    const value = JSON.parse(input) as Record<string, unknown>;
    if (!Number.isSafeInteger(value.size_bytes) || Number(value.size_bytes) <= 0) return null;
    if (typeof value.content_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.content_hash)) return null;
    return { sizeBytes: Number(value.size_bytes), contentHash: value.content_hash };
  } catch {
    return null;
  }
}

function generatedManifest(metadata: GeneratedObjectMetadata): string {
  return JSON.stringify({ size_bytes: metadata.sizeBytes, content_hash: metadata.contentHash });
}

class ChunkAccumulator {
  private readonly chunks: Uint8Array[] = [];
  private firstOffset = 0;
  byteLength = 0;

  push(chunk: Uint8Array): void {
    if (!chunk.byteLength) return;
    this.chunks.push(chunk);
    this.byteLength += chunk.byteLength;
  }

  take(length = this.byteLength): Buffer {
    if (length < 0 || length > this.byteLength) throw new Error("Invalid buffered asset length");
    const result = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const chunk = this.chunks[0]!;
      const available = chunk.byteLength - this.firstOffset;
      const consumed = Math.min(available, length - written);
      result.set(chunk.subarray(this.firstOffset, this.firstOffset + consumed), written);
      written += consumed;
      this.firstOffset += consumed;
      if (this.firstOffset === chunk.byteLength) {
        this.chunks.shift();
        this.firstOffset = 0;
      }
    }
    this.byteLength -= length;
    return result;
  }
}

async function consumeVerifiedBody(
  asset: StoredAsset,
  body: ReadableStream<Uint8Array> | null,
  consume: (chunk: Uint8Array) => Promise<void> | void,
): Promise<void> {
  const hash = createHash("sha256");
  let size = 0;
  if (body) {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > asset.sizeBytes) throw new AssetIntegrityError("Asset size mismatch");
        hash.update(value);
        await consume(value);
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
        // Preserve the integrity or storage error that stopped consumption.
      }
      throw error;
    }
  }
  if (size !== asset.sizeBytes || hash.digest("hex") !== asset.contentHash) {
    throw new AssetIntegrityError();
  }
}

export function contentDisposition(filename: string, inline: boolean): string {
  const safe = basename(filename).replaceAll(/[\r\n"\\]/g, "_").slice(0, 240);
  return `${inline ? "inline" : "attachment"}; filename="${safe}"`;
}

const INLINE_TYPES = /^(image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|ogg|wav)|application\/pdf|text\/html)$/;
export function mayRenderInline(contentType: string): boolean {
  return INLINE_TYPES.test(contentType.toLowerCase());
}

export class S3Storage implements ObjectStorageBackend {
  constructor(
    private readonly client = new S3Client({
      region: process.env.AWS_REGION ?? "eu-west-2",
      ...(process.env.AWS_CREDENTIALS_FILE
        ? { credentials: credentialsFromFile(process.env.AWS_CREDENTIALS_FILE) }
        : {}),
    }),
    private readonly options: S3StorageConfig = {
      region: process.env.AWS_REGION ?? "eu-west-2",
      bucket: process.env.ASSET_BUCKET ?? "",
      kmsKeyId: process.env.KMS_KEY_ID ?? "",
    },
  ) {}

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    const checksum = Buffer.from(asset.contentHash, "hex").toString("base64");
    try {
      if (asset.sizeBytes <= S3_MULTIPART_PART_SIZE) {
        const buffered = new ChunkAccumulator();
        await consumeVerifiedBody(asset, body, (chunk) => buffered.push(chunk));
        await this.client.send(new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: asset.objectKey,
          Body: buffered.take(),
          ContentType: asset.contentType,
          ContentLength: asset.sizeBytes,
          ChecksumSHA256: checksum,
          Metadata: { sha256: asset.contentHash },
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.options.kmsKeyId,
        }));
        return;
      }

      const created = await this.client.send(new CreateMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: asset.objectKey,
        ContentType: asset.contentType,
        ChecksumAlgorithm: "SHA256",
        Metadata: { sha256: asset.contentHash },
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.options.kmsKeyId,
      }));
      if (!created.UploadId) throw new Error("S3 did not create an asset multipart upload");
      const uploadId = created.UploadId;
      const parts: Array<{ ETag: string; PartNumber: number; ChecksumSHA256: string }> = [];
      const buffered = new ChunkAccumulator();
      let completed = false;
      const uploadPart = async (bytes: Buffer) => {
        const partNumber = parts.length + 1;
        const partChecksum = createHash("sha256").update(bytes).digest("base64");
        const uploaded = await this.client.send(new UploadPartCommand({
          Bucket: this.options.bucket,
          Key: asset.objectKey,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ChecksumSHA256: partChecksum,
        }));
        if (!uploaded.ETag) throw new Error("S3 did not return an asset part ETag");
        parts.push({ ETag: uploaded.ETag, PartNumber: partNumber, ChecksumSHA256: partChecksum });
      };
      try {
        await consumeVerifiedBody(asset, body, async (chunk) => {
          buffered.push(chunk);
          while (buffered.byteLength >= S3_MULTIPART_PART_SIZE) {
            await uploadPart(buffered.take(S3_MULTIPART_PART_SIZE));
          }
        });
        if (buffered.byteLength) await uploadPart(buffered.take());
        await this.client.send(new CompleteMultipartUploadCommand({
          Bucket: this.options.bucket,
          Key: asset.objectKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }));
        completed = true;
      } finally {
        if (!completed) {
          await this.client.send(new AbortMultipartUploadCommand({
            Bucket: this.options.bucket,
            Key: asset.objectKey,
            UploadId: uploadId,
          })).catch(() => undefined);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "BadDigest") {
        throw new AssetIntegrityError("Asset checksum mismatch");
      }
      throw error;
    }
  }

  async writeGenerated(
    objectKey: string,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<GeneratedObjectMetadata> {
    if (!body) throw new Error("Generated object body is missing");
    const created = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      ContentType: "application/zip",
      ChecksumAlgorithm: "SHA256",
      Metadata: { generated: "knowledge-export" },
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: this.options.kmsKeyId,
    }));
    if (!created.UploadId) throw new Error("S3 did not create an export multipart upload");
    const uploadId = created.UploadId;
    const parts: Array<{ ETag: string; PartNumber: number; ChecksumSHA256: string }> = [];
    const buffered = new ChunkAccumulator();
    const hash = createHash("sha256");
    let sizeBytes = 0;
    let completed = false;
    const uploadPart = async (bytes: Buffer) => {
      const partNumber = parts.length + 1;
      const partChecksum = createHash("sha256").update(bytes).digest("base64");
      const uploaded = await this.client.send(new UploadPartCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ChecksumSHA256: partChecksum,
      }));
      if (!uploaded.ETag) throw new Error("S3 did not return an export part ETag");
      parts.push({ ETag: uploaded.ETag, PartNumber: partNumber, ChecksumSHA256: partChecksum });
    };
    try {
      const reader = body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          sizeBytes += chunk.value.byteLength;
          if (sizeBytes > MAX_GENERATED_OBJECT_BYTES) throw new Error("Generated object is too large");
          hash.update(chunk.value);
          buffered.push(chunk.value);
          while (buffered.byteLength >= S3_MULTIPART_PART_SIZE) {
            await uploadPart(buffered.take(S3_MULTIPART_PART_SIZE));
          }
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      if (!sizeBytes) throw new Error("Generated object is empty");
      if (buffered.byteLength) await uploadPart(buffered.take());
      await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }));
      completed = true;
    } finally {
      if (!completed) {
        await this.client.send(new AbortMultipartUploadCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
          UploadId: uploadId,
        })).catch(() => undefined);
      }
    }

    const metadata = { sizeBytes, contentHash: hash.digest("hex") };
    const footerRange = zipFooterRange(sizeBytes);
    if (!footerRange) {
      await this.delete(objectKey);
      throw new Error("Generated ZIP is too short to be finalized");
    }
    const footerResult = await this.client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      Range: `bytes=${footerRange.start}-${footerRange.end}`,
    }));
    if (!footerResult.Body
        || !isFinalizedZipFooter(await footerResult.Body.transformToByteArray())) {
      await this.delete(objectKey);
      throw new Error("Generated ZIP central directory was not finalized");
    }
    const manifest = generatedManifest(metadata);
    const manifestHash = createHash("sha256").update(manifest).digest("base64");
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: generatedManifestKey(objectKey),
      Body: manifest,
      ContentType: "application/json",
      ContentLength: Buffer.byteLength(manifest),
      ChecksumSHA256: manifestHash,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: this.options.kmsKeyId,
    }));
    return metadata;
  }

  async inspectGenerated(objectKey: string): Promise<GeneratedObjectMetadata | null> {
    try {
      const [manifestResult, objectResult] = await Promise.all([
        this.client.send(new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: generatedManifestKey(objectKey),
        })),
        this.client.send(new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        })),
      ]);
      if (!manifestResult.Body) return null;
      const metadata = parseGeneratedManifest(await manifestResult.Body.transformToString());
      return metadata && objectResult.ContentLength === metadata.sizeBytes ? metadata : null;
    } catch (error) {
      if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) return null;
      throw error;
    }
  }

  async deleteGenerated(objectKey: string): Promise<void> {
    await Promise.all([
      this.delete(objectKey),
      this.delete(generatedManifestKey(objectKey)),
    ]);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }));
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) return false;
      throw error;
    }
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      if (!result.Body) throw new AssetNotFoundError();
      return result.Body.transformToWebStream() as BodyInit;
    } catch (error) {
      if (error instanceof AssetNotFoundError) throw error;
      if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) {
        throw new AssetNotFoundError();
      }
      throw error;
    }
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey, ChecksumMode: "ENABLED" }));
      const checksumMatches = result.ChecksumSHA256 === Buffer.from(contentHash, "hex").toString("base64")
        || result.Metadata?.sha256 === contentHash;
      return result.ContentLength === sizeBytes && checksumMatches;
    } catch {
      return false;
    }
  }
}

export class FilesystemStorage implements ObjectStorageBackend {
  private readonly root: string;

  constructor(root = process.env.STORAGE_PATH ?? "./data/assets") {
    this.root = resolve(root);
  }

  private path(objectKey: string): string {
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}/`)) throw new Error("Invalid object key");
    return path;
  }

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    const path = this.path(asset.objectKey);
    const temporaryPath = `${path}.upload-${crypto.randomUUID()}`;
    await mkdir(resolve(path, ".."), { recursive: true });
    try {
      const hash = createHash("sha256");
      let size = 0;
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.byteLength;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(nodeStream(body), verifier, createWriteStream(temporaryPath, { flags: "wx" }));
      if (size !== asset.sizeBytes || hash.digest("hex") !== asset.contentHash) {
        throw new AssetIntegrityError();
      }
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async writeGenerated(
    objectKey: string,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<GeneratedObjectMetadata> {
    if (!body) throw new Error("Generated object body is missing");
    const path = this.path(objectKey);
    const manifestPath = this.path(generatedManifestKey(objectKey));
    const temporaryPath = `${path}.upload-${crypto.randomUUID()}`;
    const temporaryManifestPath = `${manifestPath}.upload-${crypto.randomUUID()}`;
    await mkdir(resolve(path, ".."), { recursive: true });
    let sizeBytes = 0;
    const hash = createHash("sha256");
    try {
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sizeBytes += chunk.byteLength;
          if (sizeBytes > MAX_GENERATED_OBJECT_BYTES) {
            callback(new Error("Generated object is too large"));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(nodeStream(body), verifier, createWriteStream(temporaryPath, { flags: "wx" }));
      if (!sizeBytes) throw new Error("Generated object is empty");
      const metadata = { sizeBytes, contentHash: hash.digest("hex") };
      const footerRange = zipFooterRange(sizeBytes);
      const footer = footerRange
        ? await Bun.file(temporaryPath).slice(footerRange.start, footerRange.end + 1).bytes()
        : new Uint8Array();
      if (!isFinalizedZipFooter(footer)) {
        throw new Error("Generated ZIP central directory was not finalized");
      }
      await writeFile(temporaryManifestPath, generatedManifest(metadata), { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, path);
      await rename(temporaryManifestPath, manifestPath);
      return metadata;
    } catch (error) {
      await Promise.all([
        unlink(temporaryPath).catch(() => undefined),
        unlink(temporaryManifestPath).catch(() => undefined),
      ]);
      throw error;
    }
  }

  async inspectGenerated(objectKey: string): Promise<GeneratedObjectMetadata | null> {
    const file = Bun.file(this.path(objectKey));
    const manifest = Bun.file(this.path(generatedManifestKey(objectKey)));
    if (!await file.exists() || !await manifest.exists()) return null;
    const metadata = parseGeneratedManifest(await manifest.text());
    return metadata && file.size === metadata.sizeBytes ? metadata : null;
  }

  async deleteGenerated(objectKey: string): Promise<void> {
    await Promise.all([
      this.delete(objectKey),
      this.delete(generatedManifestKey(objectKey)),
    ]);
  }

  async delete(objectKey: string): Promise<void> {
    const file = Bun.file(this.path(objectKey));
    if (await file.exists()) await file.delete();
  }

  async exists(objectKey: string): Promise<boolean> {
    return Bun.file(this.path(objectKey)).exists();
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    const file = Bun.file(this.path(objectKey));
    if (!(await file.exists())) throw new AssetNotFoundError();
    return range ? file.slice(range.start, range.end + 1) : file;
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    const file = Bun.file(this.path(objectKey));
    if (!(await file.exists()) || file.size !== sizeBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file.name!)) hash.update(chunk);
    return hash.digest("hex") === contentHash;
  }
}
