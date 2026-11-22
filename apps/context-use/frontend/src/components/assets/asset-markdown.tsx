import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useContext } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { type AssetPreview, assetPreviewQueryOptions } from '../../queries/assets';
import { ResourceNavigation } from '../knowledge/resource-navigation';
import { AssetLink } from './asset-link';
import { AssetMedia } from './asset-media';
import { AssetPreviewFallback } from './asset-preview-fallback';
import { AssetEmbedPlaceholder, DeferredAsset } from './deferred-asset';

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
        href={assetContentUrl({ readableId: readableId })}
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

type EmbedProps = {
  readableId: string;
  asset?: AssetPreview;
  alt?: string;
  className?: string;
  linked?: boolean;
};

export function AssetMarkdownEmbed(props: EmbedProps) {
  if (props.asset?.mediaType.startsWith('audio/')) {
    return null;
  }
  return (
    <DeferredAsset key={props.readableId} className={props.className}>
      {props.asset ? (
        <AssetEmbedMedia {...props} asset={props.asset} />
      ) : (
        <FetchedAssetEmbed {...props} />
      )}
    </DeferredAsset>
  );
}

function FetchedAssetEmbed(props: EmbedProps) {
  const preview = useQuery(assetPreviewQueryOptions(props.readableId));
  if (preview.data) {
    return <AssetEmbedMedia {...props} asset={preview.data} />;
  }
  return preview.error ? (
    <AssetPreviewFallback message="This asset is unavailable.">
      {!props.linked && (
        <AssetMarkdownLink readableId={props.readableId}>Open asset</AssetMarkdownLink>
      )}
    </AssetPreviewFallback>
  ) : (
    <AssetEmbedPlaceholder />
  );
}

function AssetEmbedMedia({ asset, alt, linked }: EmbedProps & { asset: AssetPreview }) {
  if (asset.mediaType.startsWith('audio/')) {
    return null;
  }
  return (
    <AssetMedia
      asset={{ ...asset, name: alt || asset.name }}
      className="bg-muted"
      fallback={
        <AssetPreviewFallback message="This file could not be previewed.">
          {!linked && (
            <AssetMarkdownLink readableId={asset.readableId}>Open asset</AssetMarkdownLink>
          )}
        </AssetPreviewFallback>
      }
    />
  );
}
