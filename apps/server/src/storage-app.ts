import { timingSafeEqual } from "node:crypto";
import { unlink } from "node:fs/promises";
import { chmod } from "node:fs/promises";
import { AssetRepository, createPool, StoragePublicationRepository } from "@context-use/database";
import { AssetPath } from "@context-use/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import { config } from "./config.ts";
import { FilesystemStorage, S3Storage, type ByteRange, type ObjectStorageBackend } from "./storage.ts";

const objectKeySchema = z.string().regex(/^objects\/[a-f0-9-]{36}$/);
const verificationSchema = z.object({
  object_key: objectKeySchema,
  size_bytes: z.number().int().nonnegative().max(5_000_000_000),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function sameSecret(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: Request): string {
  return request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1] ?? "";
}

type StorageBrokerTokens = { dashboard: string; mcp: string; public: string };

type PublishedAssetLookup = {
  assetByPublicPath(publicPath: string): Promise<{ s3_object_key: string } | null>;
};

type PrivateAssetLookup = {
  getForStorage(id: string): Promise<{
    id: string;
    s3_object_key: string;
    filename: string;
    content_type: string;
    size_bytes: number | string;
    content_hash: string;
  } | null>;
  getDeletedForStorage(id: string): Promise<{
    id: string;
    s3_object_key: string;
  } | null>;
};

function privateCapability(
  request: Request,
  tokens: StorageBrokerTokens,
): "dashboard" | "mcp" | null {
  const supplied = bearer(request);
  if (sameSecret(supplied, tokens.dashboard)) return "dashboard";
  if (sameSecret(supplied, tokens.mcp)) return "mcp";
  return null;
}

function publicAuthorized(request: Request, tokens: StorageBrokerTokens): boolean {
  const supplied = bearer(request);
  return sameSecret(supplied, tokens.public);
}

function parseRange(value: string | null): ByteRange | undefined {
  const match = value?.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<start) return undefined;
  return { start, end };
}

const defaultStorage: ObjectStorageBackend = config.STORAGE_DRIVER === "s3"
  ? new S3Storage(undefined, {
      region: config.AWS_REGION,
      bucket: config.ASSET_BUCKET,
      kmsKeyId: config.KMS_KEY_ID,
    })
  : new FilesystemStorage(config.STORAGE_PATH);

const storagePool = createPool(config.STORAGE_DATABASE_URL, { application_name: "context-use-storage-boundary" });
const defaultPrivateAssets = new AssetRepository(storagePool);
const defaultPublicAssets = new StoragePublicationRepository(storagePool);
const defaultTokens: StorageBrokerTokens = {
  dashboard: config.STORAGE_DASHBOARD_TOKEN,
  mcp: config.STORAGE_MCP_TOKEN,
  public: config.STORAGE_PUBLIC_TOKEN,
};

function denied(): Response {
  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}

async function readObject(
  storage: ObjectStorageBackend,
  objectKey: string,
  range: ByteRange | undefined,
): Promise<Response> {
  try {
    const body = await storage.read(objectKey, range);
    return new Response(body, { status: range ? 206 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return denied();
  }
}

export function createStorageBrokerApp(input: {
  storage: ObjectStorageBackend;
  privateAssets: PrivateAssetLookup;
  publicAssets: PublishedAssetLookup;
  tokens: StorageBrokerTokens;
}) {
  const { storage, privateAssets, publicAssets, tokens } = input;
  const activeWrites = new Set<string>();
  return new Elysia({ serve: { maxRequestBodySize: 5_100_000_000 } })
  .onError(() => denied())
  .get("/health", () => ({ status: "ok" }))
  .put("/private/object", async ({ request }) => {
    if (!privateCapability(request, tokens)) return denied();
    const sizeBytes = Number(request.headers.get("content-length"));
    const asset = {
      id: z.string().uuid().parse(request.headers.get("x-asset-id")),
      objectKey: objectKeySchema.parse(request.headers.get("x-object-key")),
      filename: decodeURIComponent(z.string().min(1).max(1_000).parse(request.headers.get("x-filename"))),
      contentType: z.string().min(1).max(255).parse(request.headers.get("x-content-type")),
      sizeBytes: z.number().int().nonnegative().max(5_000_000_000).parse(sizeBytes),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/).parse(request.headers.get("x-content-sha256")),
    };
    if (asset.objectKey !== `objects/${asset.id}`) return denied();
    const expected = await privateAssets.getForStorage(asset.id);
    if (!expected
        || expected.s3_object_key !== asset.objectKey
        || expected.filename !== asset.filename
        || expected.content_type !== asset.contentType
        || Number(expected.size_bytes) !== asset.sizeBytes
        || expected.content_hash !== asset.contentHash) return denied();
    if (activeWrites.has(asset.objectKey)) return denied();
    activeWrites.add(asset.objectKey);
    try {
      // Asset bytes are immutable. This blocks a compromised MCP process from
      // replacing a private or published object whose key it can read.
      if (await storage.exists(asset.objectKey)) return denied();
      await storage.write(asset, request.body);
      return new Response(null, { status: 204 });
    } finally {
      activeWrites.delete(asset.objectKey);
    }
  }, { parse: "none" })
  .get("/private/object", async ({ request, query }) => {
    if (!privateCapability(request, tokens)) return denied();
    return readObject(storage, objectKeySchema.parse(query.key), parseRange(request.headers.get("range")));
  })
  .delete("/private/object", async ({ request, query }) => {
    if (privateCapability(request, tokens) !== "dashboard") return denied();
    const objectKey = objectKeySchema.parse(query.key);
    const id = z.string().uuid().parse(objectKey.slice("objects/".length));
    const deleted = await privateAssets.getDeletedForStorage(id);
    // Metadata is the lifecycle authority. A published row cannot become
    // deleted until passkey-confirmed unpublication clears its visibility, so
    // a bare dashboard storage capability cannot hide public bytes.
    if (!deleted || deleted.s3_object_key !== objectKey) return denied();
    await storage.delete(objectKey);
    return new Response(null, { status: 204 });
  })
  .post("/private/verify", async ({ request }) => {
    if (privateCapability(request, tokens) !== "dashboard") return denied();
    const input = verificationSchema.parse(await request.json());
    return Response.json({
      verified: await storage.verify(input.object_key, input.size_bytes, input.content_hash),
    }, { headers: { "cache-control": "no-store" } });
  })
  .get("/public/object", async ({ request, query }) => {
    if (!publicAuthorized(request, tokens)) return denied();
    const publicPath = AssetPath.parse(query.path);
    const asset = await publicAssets.assetByPublicPath(publicPath);
    if (!asset) return denied();
    return readObject(storage, objectKeySchema.parse(asset.s3_object_key), parseRange(request.headers.get("range")));
  });
}

export const storageApp = createStorageBrokerApp({
  storage: defaultStorage,
  privateAssets: defaultPrivateAssets,
  publicAssets: defaultPublicAssets,
  tokens: defaultTokens,
});

export async function listenStorageSocket(): Promise<void> {
  const socketPath = config.STORAGE_SOCKET_PATH;
  await unlink(socketPath).catch(() => undefined);
  Bun.serve({ unix: socketPath, fetch: storageApp.handle });
  await chmod(socketPath, 0o660);
  console.info("context-use storage broker listening on unix socket");
}
