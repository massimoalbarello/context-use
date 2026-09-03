import type { StorageClient } from '#lib/storage/storage.ts';
import { detectAssetMedia } from '#models/assets/media.ts';
import {
  type Asset,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
  type StoredAsset,
} from '#models/assets/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#models/readable-ids/model.ts';
import type { AssetsRepositoryContract } from '#repositories/assets/repository.ts';

export type AssetCreateResult =
  | { state: 'created'; asset: Asset }
  | { state: 'invalid'; message: string }
  | { state: 'name_conflict' };

function hash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

export class AssetsService {
  private readonly assets: AssetsRepositoryContract;
  private readonly storage: StorageClient;

  constructor({
    assets,
    storage,
  }: {
    assets: AssetsRepositoryContract;
    storage: StorageClient;
  }) {
    this.assets = assets;
    this.storage = storage;
  }

  async create(input: {
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
    const media = detectAssetMedia(bytes);
    const id = Bun.randomUUIDv7();
    const derivedReadableId = readableIdFrom(name);
    const readableId = input.allowDuplicate
      ? readableIdWithSuffix({
          readableId: derivedReadableId,
          suffix: id.slice(-READABLE_ID_SUFFIX_LENGTH),
        })
      : derivedReadableId;
    const storageKey = `${input.ownerId}/assets/${id}/content${media.extension ? `.${media.extension}` : ''}`;
    const now = new Date().toISOString();
    const stored: StoredAsset = {
      id,
      ownerId: input.ownerId,
      readableId,
      name,
      mediaType: media.mediaType,
      extension: media.extension,
      sizeBytes: bytes.byteLength,
      contentHash: hash(bytes),
      storageKey,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.write(storageKey, new Blob([bytes], { type: media.mediaType }));
    try {
      const result = await this.assets.create(stored);
      if (result.state === 'readable_id_conflict') {
        await this.storage.delete(storageKey);
        return { state: 'name_conflict' };
      }
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
    const asset = await this.assets.detail({ ownerId: input.ownerId, readableId });
    if (!asset) {
      throw new Error('Created asset could not be read');
    }
    return { state: 'created', asset };
  }

  list(input: {
    ownerId: string;
    limit: number;
    offset: number;
    query?: string;
    kind?: 'entity_image';
  }) {
    return this.assets.list(input);
  }

  detail(input: { ownerId: string; readableId: string; usageLimit?: number }) {
    return this.assets.detail(input);
  }

  updateName(input: { ownerId: string; readableId: string; name: string }) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH) {
      return null;
    }
    return this.assets.updateName({ ...input, name, updatedAt: new Date().toISOString() });
  }

  archive(input: { ownerId: string; readableId: string }) {
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
    return { asset, blob: new Blob([bytes], { type: asset.mediaType }) };
  }
}

export type AssetsServiceContract = Pick<
  AssetsService,
  'create' | 'list' | 'detail' | 'updateName' | 'archive' | 'content'
>;
