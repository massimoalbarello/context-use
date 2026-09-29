import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useContext } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { assetPreviewQueryOptions } from '../../queries/assets';
import { ResourceNavigation } from '../knowledge/resource-navigation';
import { AssetLink } from './asset-link';
import { AssetMedia } from './asset-media';
import { AssetPreviewFallback } from './asset-preview-fallback';

export function AssetMarkdownLink({
  readableId,
  children,
}: {
  readableId: string;
  children: ReactNode;
}) {
  const navigation = useContext(ResourceNavigation);
  if (!navigation) {
    return (
      <a
        className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4"
        href={assetContentUrl(readableId)}
      >
        {children}
      </a>
    );
  }
  return (
    <AssetLink asset={{ readableId, name: readableId }} presentation="inline">
      {children}
    </AssetLink>
  );
}

export function AssetMarkdownEmbed({
  readableId,
  alt,
  className,
  linked = false,
}: {
  readableId: string;
  alt?: string;
  className?: string;
  linked?: boolean;
}) {
  const preview = useQuery(assetPreviewQueryOptions(readableId));
  const openAsset = linked ? null : (
    <AssetMarkdownLink readableId={readableId}>Open asset</AssetMarkdownLink>
  );
  return (
    <div className={className ?? 'markdown-asset'}>
      {preview.data ? (
        <AssetMedia
          asset={{ ...preview.data, name: alt || preview.data.name }}
          className="max-h-[36rem] w-full rounded-xl bg-muted object-contain"
          fallback={
            <AssetPreviewFallback message="This file could not be previewed.">
              {openAsset}
            </AssetPreviewFallback>
          }
        />
      ) : preview.error ? (
        <AssetPreviewFallback message="This asset is unavailable.">
          {openAsset}
        </AssetPreviewFallback>
      ) : (
        <span className="text-muted-foreground text-sm" role="status">
          Loading media…
        </span>
      )}
    </div>
  );
}
