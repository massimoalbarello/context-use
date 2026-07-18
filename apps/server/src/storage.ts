import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
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
import { config } from "./config.ts";

export type StoredAsset = {
  id: string;
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
};

export type ByteRange = { start: number; end: number };

export interface ObjectStorage {
  write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void>;
  delete(objectKey: string): Promise<void>;
  read(objectKey: string, range?: ByteRange): Promise<BodyInit>;
  verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean>;
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

const INLINE_TYPES = /^(image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|ogg|wav)|application\/pdf)$/;
export function mayRenderInline(contentType: string): boolean {
  return INLINE_TYPES.test(contentType.toLowerCase());
}

export class S3Storage implements ObjectStorage {
  constructor(private readonly client = new S3Client({ region: config.AWS_REGION })) {}

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    const checksum = Buffer.from(asset.contentHash, "hex").toString("base64");
    try {
      if (asset.sizeBytes <= S3_MULTIPART_PART_SIZE) {
        const buffered = new ChunkAccumulator();
        await consumeVerifiedBody(asset, body, (chunk) => buffered.push(chunk));
        await this.client.send(new PutObjectCommand({
          Bucket: config.ASSET_BUCKET,
          Key: asset.objectKey,
          Body: buffered.take(),
          ContentType: asset.contentType,
          ContentLength: asset.sizeBytes,
          ChecksumSHA256: checksum,
          Metadata: { sha256: asset.contentHash },
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: config.KMS_KEY_ID,
        }));
        return;
      }

      const created = await this.client.send(new CreateMultipartUploadCommand({
        Bucket: config.ASSET_BUCKET,
        Key: asset.objectKey,
        ContentType: asset.contentType,
        ChecksumAlgorithm: "SHA256",
        Metadata: { sha256: asset.contentHash },
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: config.KMS_KEY_ID,
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
          Bucket: config.ASSET_BUCKET,
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
          Bucket: config.ASSET_BUCKET,
          Key: asset.objectKey,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }));
        completed = true;
      } finally {
        if (!completed) {
          await this.client.send(new AbortMultipartUploadCommand({
            Bucket: config.ASSET_BUCKET,
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

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: config.ASSET_BUCKET, Key: objectKey }));
  }

  async read(objectKey: string, range?: ByteRange): Promise<BodyInit> {
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: config.ASSET_BUCKET,
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
      const result = await this.client.send(new HeadObjectCommand({ Bucket: config.ASSET_BUCKET, Key: objectKey, ChecksumMode: "ENABLED" }));
      const checksumMatches = result.ChecksumSHA256 === Buffer.from(contentHash, "hex").toString("base64")
        || result.Metadata?.sha256 === contentHash;
      return result.ContentLength === sizeBytes && checksumMatches;
    } catch {
      return false;
    }
  }
}

export class FilesystemStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root = config.STORAGE_PATH) {
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

  async delete(objectKey: string): Promise<void> {
    const file = Bun.file(this.path(objectKey));
    if (await file.exists()) await file.delete();
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

export const storage: ObjectStorage = config.STORAGE_DRIVER === "s3" ? new S3Storage() : new FilesystemStorage();
