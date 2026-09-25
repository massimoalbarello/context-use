import type { Storage } from '#backend/lib/storage/storage.ts';
import { readVerifiedBytes } from '#backend/lib/storage/verified-file.ts';
import type { PublicResourcesRepositoryContract } from '#backend/repositories/public-resources/repository.ts';

export class PublicResourcesService {
  private readonly resources: PublicResourcesRepositoryContract;
  private readonly storage: Storage;

  constructor({
    resources,
    storage,
  }: {
    resources: PublicResourcesRepositoryContract;
    storage: Storage;
  }) {
    this.resources = resources;
    this.storage = storage;
  }

  async assetContent(input: { publicId: string }) {
    const asset = await this.resources.findAsset(input);
    if (!asset) {
      return null;
    }
    const bytes = await readVerifiedBytes({
      storage: this.storage,
      storageKey: asset.storageKey,
      contentHash: asset.contentHash,
      sizeBytes: asset.sizeBytes,
      label: 'Public asset',
    });
    return {
      asset: {
        name: asset.name,
        mediaType: asset.mediaType,
        extension: asset.extension,
        sizeBytes: asset.sizeBytes,
      },
      blob: new Blob([bytes], { type: asset.mediaType }),
    };
  }
}

export type PublicResourcesServiceContract = Pick<PublicResourcesService, 'assetContent'>;
