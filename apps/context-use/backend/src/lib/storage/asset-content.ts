import type { Storage } from '#backend/lib/storage/storage.ts';
import { readStoredFile } from '#backend/lib/storage/stored-file.ts';
import type { StoredAssetPreview } from '#backend/models/assets/preview.ts';

interface ContentAsset {
  name: string;
  mediaType: string;
  extension: string | null;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
  preview?: StoredAssetPreview;
}

/** Call only after the owning surface has authorized the original asset. */
export async function readAssetContent<T extends ContentAsset>({
  asset,
  storage,
  preview,
}: {
  asset: T;
  storage: Storage;
  preview?: boolean;
}) {
  const blob = await readStoredFile({
    storage,
    storageKey: asset.storageKey,
    sizeBytes: asset.sizeBytes,
    label: 'Asset blob',
  });
  if (
    preview &&
    asset.preview &&
    (await storage.exists(asset.preview.storageKey)) &&
    (await storage.size(asset.preview.storageKey)) === asset.preview.sizeBytes
  ) {
    const representation = {
      ...asset,
      ...asset.preview,
      mediaType: 'image/webp',
      extension: 'webp',
    };
    return { asset: representation, blob: storage.file(representation.storageKey) };
  }
  return { asset, blob };
}
