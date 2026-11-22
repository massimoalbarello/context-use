import type { ComponentProps, ReactNode } from 'react';
import { assetTypeLabel, formatAssetSize } from '../../lib/asset-presentation';

export function AssetPreviewContent({
  asset,
  heading: Heading,
  children,
}: {
  asset: { name: string; mediaType: string; extension?: string | null; sizeBytes: number };
  heading: 'h1' | 'h2';
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5">
      <Heading className="break-words font-semibold text-2xl">{asset.name}</Heading>
      <p className="text-muted-foreground text-sm">
        {assetTypeLabel(asset)} · {formatAssetSize(asset.sizeBytes)}
      </p>
      {children}
    </section>
  );
}

export function AssetImage({ alt, ...props }: ComponentProps<'img'> & { alt: string }) {
  return <img alt={alt} decoding="async" style={{ aspectRatio: 'auto 16 / 9' }} {...props} />;
}
