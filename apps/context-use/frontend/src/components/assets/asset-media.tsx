import { assetContentUrl, isEmbeddableAsset, isVideoAsset } from '../../lib/asset-presentation';

type PreviewableAsset = {
  readableId: string;
  name: string;
  mediaType: string;
};

export function AssetMedia({ asset, className }: { asset: PreviewableAsset; className: string }) {
  const contentUrl = assetContentUrl(asset.readableId);
  if (isEmbeddableAsset(asset)) {
    return <img className={className} src={contentUrl} alt={asset.name} />;
  }
  if (isVideoAsset(asset)) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have a paired caption asset.
      <video
        className={className}
        src={contentUrl}
        aria-label={asset.name}
        controls
        playsInline
        preload="metadata"
      />
    );
  }
  return null;
}
