export interface AssetPreview {
  width: number;
  height: number;
}

export interface StoredAssetPreview extends AssetPreview {
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
}

export function assetPreviewFrom(value: string | null): StoredAssetPreview | undefined {
  return value ? (JSON.parse(value) as StoredAssetPreview) : undefined;
}
