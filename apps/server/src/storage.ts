import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
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

export type UploadDescriptor = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_in: number;
};

export interface ObjectStorage {
  createUpload(asset: StoredAsset): Promise<UploadDescriptor>;
  createDownload(asset: Pick<StoredAsset, "objectKey" | "filename" | "contentType">, inline?: boolean): Promise<string>;
  delete(objectKey: string): Promise<void>;
  read(objectKey: string): Promise<BodyInit>;
  verify(objectKey: string, sizeBytes: number, contentHash: string): Promise<boolean>;
  writeLocal?(objectKey: string, request: Request): Promise<void>;
  localFile?(objectKey: string): Bun.BunFile;
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

  async createUpload(asset: StoredAsset): Promise<UploadDescriptor> {
    const checksum = Buffer.from(asset.contentHash, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: config.ASSET_BUCKET,
      Key: asset.objectKey,
      ContentType: asset.contentType,
      ContentLength: asset.sizeBytes,
      ChecksumSHA256: checksum,
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: config.KMS_KEY_ID,
    });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn: 300 }),
      method: "PUT",
      headers: {
        "content-type": asset.contentType,
        "x-amz-checksum-sha256": checksum,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": config.KMS_KEY_ID,
      },
      expires_in: 300,
    };
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

class FilesystemStorage implements ObjectStorage {
  private readonly root = resolve(config.STORAGE_PATH);

  private path(objectKey: string): string {
    const path = resolve(this.root, objectKey);
    if (!path.startsWith(`${this.root}/`)) throw new Error("Invalid object key");
    return path;
  }

  async createUpload(asset: StoredAsset): Promise<UploadDescriptor> {
    return {
      url: `${config.APP_ORIGIN}/api/dashboard/assets/${asset.id}/content`,
      method: "PUT",
      headers: { "content-type": asset.contentType },
      expires_in: 300,
    };
  }

  async createDownload(asset: Pick<StoredAsset, "objectKey">): Promise<string> {
    return `${config.APP_ORIGIN}/api/dashboard/assets/object/${encodeURIComponent(asset.objectKey)}`;
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

  async verify(objectKey: string, sizeBytes: number, _contentHash: string): Promise<boolean> {
    const file = Bun.file(this.path(objectKey));
    return await file.exists() && file.size === sizeBytes;
  }

  async writeLocal(objectKey: string, request: Request): Promise<void> {
    const path = this.path(objectKey);
    await mkdir(resolve(path, ".."), { recursive: true });
    await Bun.write(path, await request.arrayBuffer());
  }

  localFile(objectKey: string): Bun.BunFile {
    return Bun.file(this.path(objectKey));
  }
}

export const storage: ObjectStorage = config.STORAGE_DRIVER === "s3" ? new S3Storage() : new FilesystemStorage();
