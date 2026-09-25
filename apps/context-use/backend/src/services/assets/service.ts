import { getStreamAsArrayBuffer } from 'get-stream';
import type { StorageClient } from '#backend/lib/storage/storage.ts';
import { readVerifiedBytes } from '#backend/lib/storage/verified-file.ts';
import { detectAssetMedia } from '#backend/models/assets/media.ts';
import {
  type Asset,
  type AssetImport,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
  type StoredAsset,
} from '#backend/models/assets/model.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#backend/models/readable-ids/model.ts';
import type { AssetsRepositoryContract } from '#backend/repositories/assets/repository.ts';

import type { AssetFacesServiceContract } from './faces.ts';

export type AssetImportResult =
  | { state: 'ready'; readableId: string }
  | { state: 'conflict' }
  | { state: 'invalid'; message: string };

export type AssetCreateResult =
  | { state: 'created'; asset: Asset }
  | { state: 'invalid'; message: string }
  | { state: 'name_conflict' };

function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function assetValidationError(input: { name: string; sizeBytes: number }): string | null {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH) {
    return `Asset names must be between 1 and ${MAX_ASSET_NAME_LENGTH} characters.`;
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > MAX_ASSET_BYTES
  ) {
    return `Assets must be between 1 and ${MAX_ASSET_BYTES} bytes.`;
  }
  return null;
}

export class AssetsService {
  readonly faces: AssetFacesServiceContract;
  private readonly assets: AssetsRepositoryContract;
  private readonly storage: StorageClient;

  constructor({
    assets,
    storage,
    faces,
  }: {
    assets: AssetsRepositoryContract;
    faces: AssetFacesServiceContract;
    storage: StorageClient;
  }) {
    this.faces = faces;
    this.assets = assets;
    this.storage = storage;
  }

  async create(input: {
    change: ChangeContext;
    ownerId: string;
    name: string;
    file: Blob;
    allowDuplicate?: boolean;
  }): Promise<AssetCreateResult> {
    const error = assetValidationError({ name: input.name, sizeBytes: input.file.size });
    if (error) {
      return { state: 'invalid', message: error };
    }
    const name = input.name.trim();
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const id = Bun.randomUUIDv7();
    const derivedReadableId = readableIdFrom(name);
    const readableId = input.allowDuplicate
      ? readableIdWithSuffix({
          readableId: derivedReadableId,
          suffix: id.slice(-READABLE_ID_SUFFIX_LENGTH),
        })
      : derivedReadableId;
    const stored = await this.save({
      ownerId: input.ownerId,
      id,
      readableId,
      name,
      bytes,
      change: input.change,
    });
    if (!stored) {
      return { state: 'name_conflict' };
    }
    const asset = await this.assets.detail({ ownerId: input.ownerId, readableId });
    if (!asset) {
      throw new Error('Created asset could not be read');
    }
    return { state: 'created', asset };
  }

  async import(input: {
    asset: AssetImport;
    read(): Promise<ReadableStream<Uint8Array>>;
    signal: AbortSignal;
    change: ChangeContext;
  }): Promise<AssetImportResult> {
    input.signal.throwIfAborted();
    const error = assetValidationError(input.asset);
    if (error) {
      return { state: 'invalid', message: error };
    }
    const existing = await this.reuseImport(input.asset);
    if (existing) {
      return existing;
    }
    const stream = (await input.read()).pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: input.signal,
    });
    const bytes = new Uint8Array(
      await getStreamAsArrayBuffer(stream, {
        maxBuffer: input.asset.sizeBytes,
      }),
    );
    input.signal.throwIfAborted();
    if (bytes.byteLength !== input.asset.sizeBytes || hash(bytes) !== input.asset.contentHash) {
      throw new Error('Imported asset failed its integrity check');
    }
    const stored = await this.save({
      ...input.asset,
      id: Bun.randomUUIDv7(),
      bytes,
      change: input.change,
      signal: input.signal,
    });
    if (!stored) {
      return (await this.reuseImport(input.asset)) ?? { state: 'conflict' };
    }
    return { state: 'ready', readableId: stored.readableId };
  }

  private async reuseImport(asset: AssetImport): Promise<AssetImportResult | null> {
    const existing = await this.content(asset);
    if (!existing) {
      return null;
    }
    if (
      existing.asset.contentHash !== asset.contentHash ||
      existing.asset.sizeBytes !== asset.sizeBytes
    ) {
      return { state: 'conflict' };
    }
    return { state: 'ready', readableId: existing.asset.readableId };
  }

  private async save(input: {
    ownerId: string;
    id: string;
    readableId: string;
    name: string;
    bytes: Uint8Array<ArrayBuffer>;
    change: ChangeContext;
    signal?: AbortSignal;
  }): Promise<StoredAsset | null> {
    const media = await detectAssetMedia(input.bytes);
    const storageKey = `${input.ownerId}/assets/${input.id}/content${media.extension ? `.${media.extension}` : ''}`;
    const now = new Date().toISOString();
    const stored: StoredAsset = {
      id: input.id,
      ownerId: input.ownerId,
      readableId: input.readableId,
      name: input.name.trim(),
      mediaType: media.mediaType,
      extension: media.extension,
      sizeBytes: input.bytes.byteLength,
      contentHash: hash(input.bytes),
      storageKey,
      createdAt: now,
      updatedAt: now,
    };
    let created: StoredAsset | null = null;
    try {
      const size = await this.storage.write(
        storageKey,
        new Blob([input.bytes], { type: media.mediaType }),
      );
      if (size !== stored.sizeBytes) {
        throw new Error('Asset file was not fully written');
      }
      input.signal?.throwIfAborted();
      const result = await this.assets.create({ ...stored, change: input.change });
      if (result.state === 'created') {
        created = result.asset;
      }
    } catch (error) {
      try {
        if (await this.storage.exists(storageKey)) {
          await this.storage.delete(storageKey);
        }
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Asset write and cleanup failed');
      }
      throw error;
    }
    if (!created) {
      await this.storage.delete(storageKey);
      return null;
    }
    this.faces.notifyAssetSaved();
    return created;
  }

  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    visibility?: PublicationVisibility;
    kind?: 'entity_image';
  }) {
    return this.assets.list(input);
  }

  preview(input: { ownerId: string; readableId: string }) {
    return this.assets.find(input);
  }

  detail(input: { ownerId: string; readableId: string }) {
    return this.assets.detail(input);
  }

  updateName(input: { change: ChangeContext; ownerId: string; readableId: string; name: string }) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH) {
      return null;
    }
    return this.assets.updateName({ ...input, name, updatedAt: new Date().toISOString() });
  }

  archive(input: { change: ChangeContext; ownerId: string; readableId: string }) {
    return this.assets.archive({ ...input, archivedAt: new Date().toISOString() });
  }

  async content(input: {
    ownerId: string;
    readableId: string;
  }): Promise<{ asset: StoredAsset; blob: Blob } | null> {
    const asset = await this.assets.find(input);
    if (!asset) {
      return null;
    }
    const bytes = await readVerifiedBytes({
      storage: this.storage,
      storageKey: asset.storageKey,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      label: `Asset blob ${asset.id}`,
    });
    return { asset, blob: new Blob([bytes], { type: asset.mediaType }) };
  }
}

export type AssetsServiceContract = Pick<
  AssetsService,
  'create' | 'list' | 'detail' | 'preview' | 'updateName' | 'archive' | 'content' | 'faces'
>;
