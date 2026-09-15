import { publishFiles } from '#backend/lib/storage/publication.ts';
import type { StorageClient } from '#backend/lib/storage/storage.ts';
import { detectAssetMedia } from '#backend/models/assets/media.ts';
import {
  type Asset,
  MAX_ASSET_BYTES,
  MAX_ASSET_NAME_LENGTH,
  type StoredAsset,
} from '#backend/models/assets/model.ts';
import {
  READABLE_ID_SUFFIX_LENGTH,
  readableIdFrom,
  readableIdWithSuffix,
} from '#backend/models/readable-ids/model.ts';
import type { AssetImportIdentity } from '#backend/repositories/assets/imports.ts';
import type { AssetsRepositoryContract } from '#backend/repositories/assets/repository.ts';

import type { AssetFacesServiceContract } from './faces.ts';

export type AssetCreateResult =
  | { state: 'created'; asset: Asset }
  | { state: 'invalid'; message: string }
  | { state: 'name_conflict' | 'sync_conflict' | 'inactive_sync' };

export interface CreateAssetInput {
  ownerId: string;
  name: string;
  file: Blob;
  allowDuplicate?: boolean;
  sync?: { syncId: string; key: string; sha256: string };
}

const SYNC_ASSET_SUFFIX_LENGTH = 24;

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

  async create(input: CreateAssetInput): Promise<AssetCreateResult> {
    const result = await this.persist(input);
    if (result.state === 'created' && result.fresh) {
      this.faces.notifyAssetSaved();
    }
    return result.state === 'created' ? { state: 'created', asset: result.asset } : result;
  }

  findImport(input: AssetImportIdentity) {
    return this.assets.findImport(input);
  }

  private async persist(
    input: CreateAssetInput,
  ): Promise<
    | Exclude<AssetCreateResult, { state: 'created' }>
    | { state: 'created'; asset: Asset; fresh: boolean }
  > {
    if (
      input.sync &&
      (!/^[a-zA-Z0-9_-]{1,128}$/u.test(input.sync.key) ||
        !/^[a-f0-9]{64}$/u.test(input.sync.sha256))
    ) {
      return { state: 'invalid', message: 'Invalid asset key or checksum.' };
    }
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH) {
      return {
        state: 'invalid',
        message: `Asset names must be between 1 and ${MAX_ASSET_NAME_LENGTH} characters.`,
      };
    }
    const minimumBytes = input.sync ? 0 : 1;
    if (input.file.size < minimumBytes || input.file.size > MAX_ASSET_BYTES) {
      return {
        state: 'invalid',
        message: `Assets must be between ${minimumBytes} and ${MAX_ASSET_BYTES} bytes.`,
      };
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const contentHash = hash(bytes);
    if (input.sync && contentHash !== input.sync.sha256) {
      return { state: 'invalid', message: 'Asset checksum does not match its bytes.' };
    }
    const media = await detectAssetMedia(bytes);
    const id = Bun.randomUUIDv7();
    const derivedReadableId = readableIdFrom(name);
    const readableId = input.sync
      ? readableIdWithSuffix({
          readableId: derivedReadableId,
          suffix: hash(
            new TextEncoder().encode(JSON.stringify([input.sync.syncId, input.sync.key])),
          ).slice(0, SYNC_ASSET_SUFFIX_LENGTH),
        })
      : input.allowDuplicate
        ? readableIdWithSuffix({
            readableId: derivedReadableId,
            suffix: id.slice(-READABLE_ID_SUFFIX_LENGTH),
          })
        : derivedReadableId;
    const storageKey = `${input.ownerId}/assets/${id}/content${media.extension ? `.${media.extension}` : ''}`;
    const now = new Date().toISOString();
    const stored: Omit<StoredAsset, 'origin'> = {
      id,
      ownerId: input.ownerId,
      readableId,
      name,
      mediaType: media.mediaType,
      extension: media.extension,
      sizeBytes: bytes.byteLength,
      contentHash,
      storageKey,
      createdAt: now,
      updatedAt: now,
    };
    return publishFiles({
      storage: this.storage,
      publish: async (files) => {
        await files.write({ key: storageKey, file: new Blob([bytes], { type: media.mediaType }) });
        const result = await this.assets.create({ asset: stored, sync: input.sync });
        if (result.state === 'readable_id_conflict') {
          return { state: input.sync ? 'sync_conflict' : 'name_conflict' };
        }
        if (result.state === 'sync_conflict' || result.state === 'inactive_sync') {
          return { state: result.state };
        }
        const fresh = result.state === 'created';
        if (fresh) {
          files.retain([storageKey]);
        }
        const asset = await this.assets.detail({
          ownerId: input.ownerId,
          readableId: result.state === 'existing' ? result.asset.assetId : readableId,
        });
        if (!asset) {
          throw new Error('Created asset could not be read');
        }
        return { state: 'created', asset, fresh };
      },
    });
  }

  list(input: { ownerId: string; limit: number; offset: number; kind?: 'entity_image' }) {
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
    return { asset, blob };
  }
}

export type AssetsServiceContract = Pick<
  AssetsService,
  'create' | 'findImport' | 'list' | 'detail' | 'updateName' | 'archive' | 'content' | 'faces'
>;
