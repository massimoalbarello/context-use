import { createHash, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  RestorableKnowledgeAsset,
  RestorableKnowledgeRecords,
} from "@context-use/database";
import { RESTORABLE_KNOWLEDGE_FORMAT } from "@context-use/database";
import { Reader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import { z } from "zod";
import { config } from "./config.ts";
import type { ObjectStorage } from "./storage.ts";
import {
  MAX_KNOWLEDGE_ARCHIVE_BYTES,
  addKnowledgeZipText,
  addStoredKnowledgeAsset,
  streamKnowledgeZip,
  type KnowledgeZipWriter,
} from "./knowledge-zip.ts";

const ARCHIVE_ROOT = "context-use-restorable-archive";
const MANIFEST_PATH = `${ARCHIVE_ROOT}/manifest.json`;
const RECORDS_PATH = `${ARCHIVE_ROOT}/records.json`;
const MAX_RECORDS_BYTES = MAX_KNOWLEDGE_ARCHIVE_BYTES;

const uuid = z.string().uuid();
const timestamp = z.string().min(1).max(64).refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const nullableTimestamp = timestamp.nullable();
const path = z.string().max(2_000);
const actorKind = z.enum(["dashboard", "mcp"]);
const nonnegativeIntegerText = z.string().regex(/^\d+$/).refine((value) => Number(value) <= Number.MAX_SAFE_INTEGER);
const positiveIntegerText = z.string().regex(/^[1-9]\d*$/);

const recordsSchema = z.object({
  directories: z.array(z.object({
    id: uuid,
    current_path: path,
    version_number: z.number().int().positive(),
    title: z.string(),
    summary: z.string(),
    created_at: timestamp,
    updated_at: timestamp,
  }).strict()),
  pages: z.array(z.object({
    id: uuid,
    current_path: path,
    current_version_id: uuid,
    published_version_id: uuid.nullable(),
    public_path: path.nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: nullableTimestamp,
  }).strict()),
  page_versions: z.array(z.object({
    id: uuid,
    page_id: uuid,
    version_number: z.number().int().positive(),
    path,
    title: z.string(),
    summary: z.string(),
    body_markdown: z.string(),
    commit_message: z.string(),
    actor_kind: actorKind,
    actor_subject: z.string(),
    created_at: timestamp,
  }).strict()),
  assets: z.array(z.object({
    id: uuid,
    current_path: path,
    public_path: path.nullable(),
    filename: z.string(),
    content_type: z.string(),
    size_bytes: nonnegativeIntegerText,
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    s3_object_key: z.string(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    duration_seconds: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
    created_at: timestamp,
    deleted_at: nullableTimestamp,
  }).strict()),
  asset_links: z.array(z.object({
    source_version_id: uuid,
    target_asset_id: uuid,
    created_at: timestamp,
  }).strict()),
  page_changes: z.array(z.object({
    change_sequence: positiveIntegerText,
    page_id: uuid,
    version_id: uuid,
    version_number: z.number().int().positive(),
    change_kind: z.enum(["created", "updated", "archived", "deleted"]),
    path,
    title: z.string(),
    commit_message: z.string(),
    actor_kind: actorKind.nullable(),
    actor_subject: z.string().nullable(),
    changed_at: timestamp,
  }).strict()),
}).strict();

const manifestSchema = z.object({
  format: z.literal(RESTORABLE_KNOWLEDGE_FORMAT),
  schema_version: z.literal(1),
  created_at: timestamp,
  context_use_version: z.string().min(1).max(64),
  records_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  counts: z.object({
    directories: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
    page_versions: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative(),
    active_assets: z.number().int().nonnegative(),
    asset_links: z.number().int().nonnegative(),
    page_changes: z.number().int().nonnegative(),
  }).strict(),
  active_asset_bytes: z.number().int().nonnegative().max(MAX_KNOWLEDGE_ARCHIVE_BYTES),
}).strict();

export type RestorableKnowledgeManifest = z.infer<typeof manifestSchema>;

export class InvalidKnowledgeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeArchiveError";
  }
}

class ArchiveAssetStageError extends Error {
  constructor(readonly stageCause: unknown) {
    super("Knowledge archive asset staging failed");
  }
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Archive has duplicate ${label}`);
}

function parentPath(currentPath: string): string {
  return currentPath.includes("/") ? currentPath.replace(/\/[^/]+$/, "") : "";
}

export function validateRestorableKnowledgeRecords(input: unknown): RestorableKnowledgeRecords {
  const records = recordsSchema.parse(input) as RestorableKnowledgeRecords;
  unique(records.directories.map(({ id }) => id), "directory IDs");
  unique(records.directories.map(({ current_path }) => current_path), "directory paths");
  unique(records.pages.map(({ id }) => id), "page IDs");
  unique(records.page_versions.map(({ id }) => id), "page-version IDs");
  unique(records.assets.map(({ id }) => id), "asset IDs");
  unique(records.assets.map(({ s3_object_key }) => s3_object_key), "asset object keys");
  unique(records.asset_links.map((link) => `${link.source_version_id}:${link.target_asset_id}`), "asset links");
  unique(records.page_changes.map(({ change_sequence }) => change_sequence), "change sequence numbers");

  const directoryPaths = new Set(records.directories.map(({ current_path }) => current_path));
  if (records.directories.filter(({ current_path }) => current_path === "").length !== 1) {
    throw new Error("Archive must contain exactly one root knowledge directory");
  }
  for (const directory of records.directories) {
    if (directory.current_path && !directoryPaths.has(parentPath(directory.current_path))) {
      throw new Error(`Archive directory has no parent: ${directory.current_path}`);
    }
  }

  const pageIds = new Set(records.pages.map(({ id }) => id));
  const versions = new Map(records.page_versions.map((version) => [version.id, version]));
  const versionsPerPage = new Set<string>();
  for (const version of records.page_versions) {
    if (!pageIds.has(version.page_id)) throw new Error(`Archive page version has no page: ${version.id}`);
    const key = `${version.page_id}:${version.version_number}`;
    if (versionsPerPage.has(key)) throw new Error("Archive has duplicate page version numbers");
    versionsPerPage.add(key);
  }
  for (const page of records.pages) {
    const current = versions.get(page.current_version_id);
    if (!current || current.page_id !== page.id || current.path !== page.current_path) {
      throw new Error(`Archive page has an invalid current version: ${page.id}`);
    }
    if (page.published_version_id) {
      const published = versions.get(page.published_version_id);
      if (!published || published.page_id !== page.id || !page.public_path || page.archived_at) {
        throw new Error(`Archive page has an invalid published version: ${page.id}`);
      }
    } else if (page.public_path) {
      throw new Error(`Archive page has an incomplete publication state: ${page.id}`);
    }
    if (!directoryPaths.has(parentPath(page.current_path))) {
      throw new Error(`Archive page has no parent directory: ${page.current_path}`);
    }
  }
  if (records.pages.filter((page) => page.current_path === "agents").length !== 1
      || records.pages.find((page) => page.current_path === "agents")?.archived_at) {
    throw new Error("Archive must contain exactly one active root AGENTS.md page");
  }
  unique(records.pages.filter(({ archived_at }) => !archived_at).map(({ current_path }) => current_path), "active page paths");
  unique(records.pages.flatMap(({ public_path }) => public_path ? [public_path] : []), "public page paths");

  const assetIds = new Set(records.assets.map(({ id }) => id));
  for (const asset of records.assets) {
    if (asset.s3_object_key !== `objects/${asset.id}`) throw new Error(`Archive asset has an invalid object key: ${asset.id}`);
    if (asset.public_path && asset.deleted_at) throw new Error(`Archive has a published deleted asset: ${asset.id}`);
  }
  unique(records.assets.filter(({ deleted_at }) => !deleted_at).map(({ current_path }) => current_path), "active asset paths");
  unique(records.assets.flatMap(({ public_path }) => public_path ? [public_path] : []), "public asset paths");
  for (const link of records.asset_links) {
    if (!versions.has(link.source_version_id) || !assetIds.has(link.target_asset_id)) {
      throw new Error("Archive contains an asset link with a missing target");
    }
  }
  return records;
}

function manifestFor(records: RestorableKnowledgeRecords, recordsJson: string): RestorableKnowledgeManifest {
  const activeAssets = records.assets.filter((asset) => !asset.deleted_at);
  return {
    format: RESTORABLE_KNOWLEDGE_FORMAT,
    schema_version: 1,
    created_at: new Date().toISOString(),
    context_use_version: "0.1.71",
    records_sha256: createHash("sha256").update(recordsJson).digest("hex"),
    counts: {
      directories: records.directories.length,
      pages: records.pages.length,
      page_versions: records.page_versions.length,
      assets: records.assets.length,
      active_assets: activeAssets.length,
      asset_links: records.asset_links.length,
      page_changes: records.page_changes.length,
    },
    active_asset_bytes: activeAssets.reduce((total, asset) => total + Number(asset.size_bytes), 0),
  };
}

async function writeArchive(
  zip: KnowledgeZipWriter,
  records: RestorableKnowledgeRecords,
  storage: ObjectStorage,
  signal: AbortSignal,
): Promise<void> {
  const recordsJson = JSON.stringify(records);
  const manifest = manifestFor(records, recordsJson);
  await addKnowledgeZipText(zip, MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, signal);
  await addKnowledgeZipText(zip, RECORDS_PATH, recordsJson, signal);
  for (const asset of records.assets) {
    if (asset.deleted_at) continue;
    await addStoredKnowledgeAsset(zip, `${ARCHIVE_ROOT}/assets/${asset.id}`, asset, storage, signal);
  }
}

export function streamRestorableKnowledgeArchive(
  records: RestorableKnowledgeRecords,
  storage: ObjectStorage,
): ReadableStream<Uint8Array> {
  return streamKnowledgeZip((zip, signal) => writeArchive(zip, records, storage, signal));
}

async function readText(readable: ReadableStream<Uint8Array> | undefined, maxBytes: number): Promise<string> {
  if (!readable) throw new Error("Archive entry has no data");
  const reader = readable.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("Archive entry too large").catch(() => undefined);
      throw new Error("Archive metadata is too large");
    }
    result += decoder.decode(chunk.value, { stream: true });
  }
  return result + decoder.decode();
}

function validateManifest(manifest: RestorableKnowledgeManifest, records: RestorableKnowledgeRecords): void {
  const activeAssets = records.assets.filter((asset) => !asset.deleted_at);
  const expected = {
    directories: records.directories.length,
    pages: records.pages.length,
    page_versions: records.page_versions.length,
    assets: records.assets.length,
    active_assets: activeAssets.length,
    asset_links: records.asset_links.length,
    page_changes: records.page_changes.length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (manifest.counts[key as keyof typeof expected] !== value) throw new Error("Archive manifest counts do not match its records");
  }
  const bytes = activeAssets.reduce((total, asset) => total + Number(asset.size_bytes), 0);
  if (manifest.active_asset_bytes !== bytes) throw new Error("Archive manifest asset size does not match its records");
}

// Piping an upload straight into a ZipReaderStream keeps the whole archive
// resident: the reader retains everything it has accepted, so peak memory
// tracks archive size rather than entry size. Spooling to disk first and then
// reading entries through a random-access reader keeps memory flat instead,
// because zip.js only pulls the byte ranges it is currently decoding.
class SpooledArchiveReader extends Reader<string> {
  size = 0;
  initialized = false;

  constructor(private readonly spoolPath: string) {
    super(spoolPath);
  }

  override async init(): Promise<void> {
    this.size = Bun.file(this.spoolPath).size;
    this.initialized = true;
  }

  override async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    const slice = Bun.file(this.spoolPath).slice(index, index + length);
    return new Uint8Array(await slice.arrayBuffer());
  }
}

async function spoolArchive(body: ReadableStream<Uint8Array>, spoolPath: string, maxBytes: number): Promise<void> {
  const sink = Bun.file(spoolPath).writer();
  const reader = body.getReader();
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new InvalidKnowledgeArchiveError("Archive contents exceed the 5 GiB restore limit");
      sink.write(chunk.value);
      // Flushing each chunk keeps the sink's own buffer from becoming the
      // memory growth this spooling exists to remove.
      await sink.flush();
    }
    await sink.end();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    sink.end();
    throw error;
  }
  if (!size) throw new InvalidKnowledgeArchiveError("Knowledge archive is empty");
}

function entryReadable(entry: FileEntry): ReadableStream<Uint8Array> {
  // The transform's own backpressure is what bounds memory here: getData only
  // advances as the consumer drains, so an entry is never held whole.
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  entry.getData(stream.writable).catch((error: unknown) => {
    void stream.writable.abort(error).catch(() => undefined);
  });
  return stream.readable;
}

export async function readRestorableKnowledgeArchive(
  body: ReadableStream<Uint8Array> | null,
  stageAsset: (asset: RestorableKnowledgeAsset, body: ReadableStream<Uint8Array>) => Promise<void>,
  options: { spoolDirectory?: string; onProgress?: (staged: number, total: number) => void } = {},
): Promise<{ manifest: RestorableKnowledgeManifest; records: RestorableKnowledgeRecords }> {
  if (!body) throw new InvalidKnowledgeArchiveError("Knowledge archive is empty");
  const spoolPath = join(options.spoolDirectory ?? config.KNOWLEDGE_IMPORT_SPOOL_PATH, `${randomUUID()}.zip`);
  let manifest: RestorableKnowledgeManifest | null = null;
  let records: RestorableKnowledgeRecords | null = null;
  let expectedAssets: Map<string, RestorableKnowledgeAsset> | null = null;
  let reader: ZipReader<string> | null = null;
  try {
    await spoolArchive(body, spoolPath, MAX_KNOWLEDGE_ARCHIVE_BYTES);
    reader = new ZipReader(new SpooledArchiveReader(spoolPath), { checkSignature: true });
    const entries = await reader.getEntries();
    const seen = new Set<string>();
    let staged = 0;
    for (const entry of entries) {
      if (entry.directory || entry.encrypted || ((entry.unixMode ?? 0) & 0o170000) === 0o120000) {
        throw new Error("Archive contains an unsupported entry");
      }
      if (seen.has(entry.filename)) throw new Error("Archive contains duplicate entries");
      seen.add(entry.filename);
      if (!manifest) {
        if (entry.filename !== MANIFEST_PATH) throw new Error("Archive manifest must be the first entry");
        if (entry.uncompressedSize > 64 * 1024) throw new Error("Archive metadata is too large");
        manifest = manifestSchema.parse(JSON.parse(await readText(entryReadable(entry), 64 * 1024)));
        continue;
      }
      if (!records) {
        if (entry.filename !== RECORDS_PATH) throw new Error("Archive records must follow the manifest");
        const raw = await readText(entryReadable(entry), MAX_RECORDS_BYTES);
        if (createHash("sha256").update(raw).digest("hex") !== manifest.records_sha256) {
          throw new Error("Archive records failed integrity verification");
        }
        records = validateRestorableKnowledgeRecords(JSON.parse(raw));
        validateManifest(manifest, records);
        if (Buffer.byteLength(raw) + manifest.active_asset_bytes > MAX_KNOWLEDGE_ARCHIVE_BYTES) {
          throw new Error("Archive contents exceed the 5 GiB restore limit");
        }
        expectedAssets = new Map(records.assets.filter((asset) => !asset.deleted_at).map((asset) => [asset.id, asset]));
        continue;
      }
      const match = entry.filename.match(new RegExp(`^${ARCHIVE_ROOT}/assets/([0-9a-f-]{36})$`));
      const asset = match ? expectedAssets!.get(match[1]!) : undefined;
      if (!asset) throw new Error(`Archive contains an unexpected entry: ${entry.filename}`);
      try {
        await stageAsset(asset, entryReadable(entry));
      } catch (error) {
        throw new ArchiveAssetStageError(error);
      }
      expectedAssets!.delete(asset.id);
      staged += 1;
      options.onProgress?.(staged, manifest.counts.active_assets);
    }
  } catch (error) {
    if (error instanceof ArchiveAssetStageError) {
      throw error.stageCause instanceof Error ? error.stageCause : new Error("Knowledge archive asset staging failed");
    }
    throw error instanceof InvalidKnowledgeArchiveError
      ? error
      : new InvalidKnowledgeArchiveError(error instanceof Error ? error.message : "Knowledge archive is invalid");
  } finally {
    await reader?.close().catch(() => undefined);
    await unlink(spoolPath).catch(() => undefined);
  }
  if (!manifest || !records) throw new InvalidKnowledgeArchiveError("Archive is missing its manifest or records");
  if (expectedAssets?.size) throw new InvalidKnowledgeArchiveError("Archive is missing one or more active asset files");
  return { manifest, records };
}
