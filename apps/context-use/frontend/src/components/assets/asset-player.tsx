import { type ReactNode, useState } from 'react';
import { AssetImage } from './asset-preview-content';
import { AssetPreviewFallback } from './asset-preview-fallback';
export function AssetPlayer({
  kind,
  src,
  name,
  className,
  fallback,
}: {
  kind: 'image' | 'video' | 'audio';
  src: string;
  name: string;
  className: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return fallback ?? <AssetPreviewFallback message="This file could not be previewed." />;
  }
  if (kind === 'image') {
    return (
      <AssetImage className={className} src={src} alt={name} onError={() => setFailed(true)} />
    );
  }
  if (kind === 'video') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: uploaded videos do not have a paired caption asset.
      <video
        className={className}
        src={src}
        aria-label={name}
        controls
        playsInline
        preload="metadata"
        style={{ aspectRatio: 'auto 16 / 9' }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: uploaded audio has no paired transcript asset.
    <audio
      className="w-full"
      src={src}
      aria-label={name}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}
