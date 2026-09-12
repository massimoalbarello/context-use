import type { Storage } from '#lib/storage/storage.ts';
import type { ImportedAsset } from '#models/assets/import.ts';
import { detectAssetMedia } from '#models/assets/media.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#models/assets/model.ts';
import { readableIdFrom, readableIdWithSuffix } from '#models/readable-ids/model.ts';
import type {
  AssetImportIdentity,
  AssetImportsRepositoryContract,
} from '#repositories/assets/imports.ts';

export type AssetImportResult =
  | { state: 'ready'; asset: ImportedAsset }
  | { state: 'invalid'; message: string }
  | { state: 'conflict' | 'inactive_sync' };

export interface ImportAssetInput extends AssetImportIdentity {
  name: string;
  sha256: string;
  file: Blob;
}

export class AssetImportsService {
  private readonly imports: AssetImportsRepositoryContract;
  private readonly storage: Storage;

  constructor({ imports, storage }: { imports: AssetImportsRepositoryContract; storage: Storage }) {
    this.imports = imports;
    this.storage = storage;
  }

  find(input: AssetImportIdentity): Promise<ImportedAsset | null> {
    return this.imports.find(input);
  }

  async upload(input: ImportAssetInput): Promise<AssetImportResult> {
    const name = input.name.trim();
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(input.key) ||
      !/^[a-f0-9]{64}$/u.test(input.sha256) ||
      !name ||
      name.length > MAX_ASSET_NAME_LENGTH ||
      input.file.size > MAX_ASSET_BYTES
    ) {
      return { state: 'invalid', message: 'Invalid asset key, checksum, name, or size.' };
    }
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    if (sha256 !== input.sha256) {
      return { state: 'invalid', message: 'Asset checksum does not match its bytes.' };
    }
    const media = await detectAssetMedia(bytes);
    const id = Bun.randomUUIDv7();
    // Every attempt writes its own immutable object. A concurrent loser cannot overwrite the winner.
    const storageKey = `${input.ownerId}/assets/${id}/content`;
    const now = new Date().toISOString();
    let retained = false;
    try {
      const written = await this.storage.write(storageKey, new Blob([bytes]));
      if (written !== bytes.byteLength) {
        throw new Error('Asset file was not fully written');
      }
      const result = await this.imports.publish({
        ownerId: input.ownerId,
        syncId: input.syncId,
        key: input.key,
        asset: {
          id,
          ownerId: input.ownerId,
          readableId: readableIdWithSuffix({
            readableId: readableIdFrom(name),
            suffix: new Bun.CryptoHasher('sha256')
              .update(JSON.stringify([input.syncId, input.key]))
              .digest('hex')
              .slice(0, 24),
          }),
          name,
          mediaType: media.mediaType,
          extension: media.extension,
          sizeBytes: bytes.byteLength,
          contentHash: sha256,
          storageKey,
          createdAt: now,
          updatedAt: now,
        },
      });
      retained = result.state === 'ready' && result.created;
      return result;
    } finally {
      if (!retained) {
        await this.storage.delete(storageKey).catch(() => undefined);
      }
    }
  }
}

export type AssetImportsServiceContract = Pick<AssetImportsService, 'find' | 'upload'>;
