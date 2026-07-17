import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.ts";

export type StoredAsset = {
  id: string;
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  contentHash: string;
};

export interface ObjectStorage {
  write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void>;
  createDownload(asset: Pick<StoredAsset, "objectKey" | "filename" | "contentType">, inline?: boolean): Promise<string>;
  delete(objectKey: string): Promise<void>;
  read(objectKey: string): Promise<BodyInit>;
  verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean>;
  localFile?(objectKey: string): Bun.BunFile;
}

export class AssetIntegrityError extends Error {
  constructor(message = "Asset bytes failed integrity verification") {
    super(message);
    this.name = "AssetIntegrityError";
  }
}

function nodeStream(body: ReadableStream<Uint8Array> | null): Readable {
  return body
    ? Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>)
    : Readable.from([]);
}

export function contentDisposition(filename: string, inline: boolean): string {
  const safe = basename(filename).replaceAll(/[\r\n"\\]/g, "_").slice(0, 240);
  return `${inline ? "inline" : "attachment"}; filename="${safe}"`;
}

const INLINE_TYPES = /^(image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|audio\/(?:mpeg|ogg|wav)|application\/pdf)$/;
export function mayRenderInline(contentType: string): boolean {
  return INLINE_TYPES.test(contentType.toLowerCase());
}

class S3Storage implements ObjectStorage {
  private readonly client = new S3Client({ region: config.AWS_REGION });

  async write(asset: StoredAsset, body: ReadableStream<Uint8Array> | null): Promise<void> {
    const checksum = Buffer.from(asset.contentHash, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: config.ASSET_BUCKET,
      Key: asset.objectKey,
      Body: nodeStream(body),
      ContentType: asset.contentType,
      ContentLength: asset.sizeBytes,
      ChecksumSHA256: checksum,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: config.KMS_KEY_ID,
    });
    try {
      await this.client.send(command);
    } catch (error) {
      if (error instanceof Error && error.name === "BadDigest") {
        throw new AssetIntegrityError("Asset checksum mismatch");
      }
      throw error;
    }
  }

  async createDownload(
    asset: Pick<StoredAsset, "objectKey" | "filename" | "contentType">,
    inline = false,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: config.ASSET_BUCKET,
        Key: asset.objectKey,
        ResponseContentType: asset.contentType,
        ResponseContentDisposition: contentDisposition(asset.filename, inline && mayRenderInline(asset.contentType)),
      }),
      { expiresIn: 300 },
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: config.ASSET_BUCKET, Key: objectKey }));
  }

  async read(objectKey: string): Promise<BodyInit> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: config.ASSET_BUCKET, Key: objectKey }));
    if (!result.Body) throw new Error("Asset bytes are missing");
    return result.Body.transformToWebStream() as BodyInit;
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: config.ASSET_BUCKET, Key: objectKey, ChecksumMode: "ENABLED" }));
      return result.ContentLength === sizeBytes && result.ChecksumSHA256 === Buffer.from(contentHash, "hex").toString("base64");
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

  async createDownload(asset: Pick<StoredAsset, "objectKey">): Promise<string> {
    return `${config.APP_ORIGIN}/api/dashboard/assets/object/${encodeURIComponent(asset.objectKey)}`;
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

  async read(objectKey: string): Promise<BodyInit> {
    const file = Bun.file(this.path(objectKey));
    if (!(await file.exists())) throw new Error("Asset bytes are missing");
    return file;
  }

  async verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean> {
    const file = Bun.file(this.path(objectKey));
    if (!(await file.exists()) || file.size !== sizeBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file.name!)) hash.update(chunk);
    return hash.digest("hex") === contentHash;
  }

  localFile(objectKey: string): Bun.BunFile {
    return Bun.file(this.path(objectKey));
  }
}

export const storage: ObjectStorage = config.STORAGE_DRIVER === "s3" ? new S3Storage() : new FilesystemStorage();
