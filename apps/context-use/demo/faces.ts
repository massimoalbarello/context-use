import type { AssetFacesServiceContract } from '#backend/services/assets/faces.ts';

/** Seeding explicitly awaits analysis; browsing only reads the resulting snapshot. */
export function createDemoFaces(faces: AssetFacesServiceContract): AssetFacesServiceContract {
  const deny = () => Promise.reject(new Error('Public demo face recognition is read-only'));
  return {
    detail: (input) => faces.detail(input),
    processSavedAsset: async () => {},
    preparePortrait: async () => {},
    images: (input) => faces.images(input),
    crop: (input) => faces.crop(input),
    settings: (input) => faces.settings(input),
    process: deny,
    annotate: deny,
    saveThreshold: deny,
    retryBatch: deny,
  };
}
