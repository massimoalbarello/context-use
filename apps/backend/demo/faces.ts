import { LOCAL_FACE_MODEL } from '#lib/face-analysis/models.ts';
import type { AssetsRepositoryContract } from '#repositories/assets/repository.ts';
import type { EntityRepositoryContract } from '#repositories/entities/repository.ts';
import type { AssetFacesServiceContract } from '#services/assets/faces.ts';

/** The public snapshot has no face analysis; browsing must never start inference. */
export function createDemoFaces({
  assets,
  entities,
}: {
  assets: AssetsRepositoryContract;
  entities: EntityRepositoryContract;
}): AssetFacesServiceContract {
  const deny = () => Promise.reject(new Error('Public demo face recognition is read-only'));
  const detail: AssetFacesServiceContract['detail'] = async (input) => {
    const asset = await assets.find(input);
    return asset
      ? {
          state: LOCAL_FACE_MODEL.supportedMediaTypes.includes(asset.mediaType)
            ? 'not_processed'
            : 'unsupported',
          error: null,
          outdated: false,
          faces: [],
        }
      : null;
  };
  return {
    detail,
    processSavedAsset: async () => {},
    preparePortrait: async () => {},
    images: async (input) =>
      (await entities.find({ ownerId: input.ownerId, readableId: input.entityReadableId }))
        ? { items: [], nextOffset: null }
        : null,
    crop: async () => null,
    settings: async () => ({
      model: LOCAL_FACE_MODEL,
      threshold: LOCAL_FACE_MODEL.defaultThreshold,
    }),
    process: deny,
    annotate: deny,
    saveThreshold: deny,
    retryBatch: deny,
  };
}
