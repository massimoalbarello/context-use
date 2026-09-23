import { getStreamAsArrayBuffer } from 'get-stream';
import type { StorageClient } from '#backend/lib/storage/storage.ts';
import { detectAssetMedia } from '#backend/models/assets/media.ts';
import {
  type Asset,
  type AssetImport,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
  type StoredAsset,
} from '#backend/models/assets/model.ts';
import type { ChangeContext } from '#backend/models/history/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#backend/models/readable-ids/model.ts';
import type { AssetsRepositoryContract } from '#backend/repositories/assets/repository.ts';

import type { AssetFacesServiceContract } from './faces.ts';

export type AssetImportResult = { state: 'ready'; readableId: string } | { state: 'conflict' };

export type AssetCreateResult =
  | { state: 'created'; asset: Asset }
  | { state: 'invalid'; message: string }
  | { state: 'name_conflict' };

function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
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

  async create(input: Parameters<AssetsService['persist']>[0]): Promise<AssetCreateResult> {
    const result = await this.persist(input);
    if (result.state === 'created') {
      this.faces.notifyAssetSaved();
    }
    return result;
  }

  private async persist(input: {
    change: ChangeContext;
    ownerId: string;
    name: string;
    file: Blob;
    allowDuplicate?: boolean;
  }): Promise<AssetCreateResult> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH) {
      return {
        state: 'invalid',
        message: `Asset names must be between 1 and ${MAX_ASSET_NAME_LENGTH} characters.`,
      };
    }
    if (input.file.size === 0 || input.file.size > MAX_ASSET_BYTES) {
      return {
        state: 'invalid',
        message: `Assets must be between 1 and ${MAX_ASSET_BYTES} bytes.`,
      };
    }
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
    const existing = await this.reuseImport(input.asset);
    if (existing) {
      return existing;
    }
    const stream = (await input.read()).pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), {
      signal: input.signal,
    });
    const bytes = new Uint8Array(
      await getStreamAsArrayBuffer(stream, {
        maxBuffer: Math.min(MAX_ASSET_BYTES, input.asset.sizeBytes),
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
    this.faces.notifyAssetSaved();
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
      name: input.name,
      mediaType: media.mediaType,
      extension: media.extension,
      sizeBytes: input.bytes.byteLength,
      contentHash: hash(input.bytes),
      storageKey,
      createdAt: now,
      updatedAt: now,
    };
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
        return result.asset;
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
    await this.storage.delete(storageKey);
    return null;
  }

  list(input: { ownerId: string; limit: number; offset: number; kind?: 'entity_image' }) {
    return this.assets.list(input);
  }

  detail(input: { ownerId: string; readableId: string; usageLimit?: number }) {
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
    if (!(await this.storage.exists(asset.storageKey))) {
      throw new Error(`Asset blob ${asset.id} is missing`);
    }
    const blob = this.storage.file(asset.storageKey);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength !== asset.sizeBytes || hash(bytes) !== asset.contentHash) {
      throw new Error(`Asset blob ${asset.id} failed its integrity check`);
    }
    return { asset, blob };
  }
}

export type AssetsServiceContract = Pick<
  AssetsService,
  'create' | 'list' | 'detail' | 'updateName' | 'archive' | 'content' | 'faces'
>;
