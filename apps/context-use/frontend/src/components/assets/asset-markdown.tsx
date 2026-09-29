import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { type AssetPreview, assetPreviewQueryOptions } from '../../queries/assets';
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
  return <DeferredAssetEmbed key={props.readableId} {...props} />;
}

function DeferredAssetEmbed({ className, ...props }: EmbedProps) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || visible) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: marker.closest('[data-collection-scroll], [data-resource-scroll]'),
        rootMargin: '160px 0px',
      },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div className={`${className ?? 'markdown-asset'} empty:hidden`} ref={markerRef}>
      {visible ? (
        props.asset ? (
          <AssetEmbedMedia {...props} asset={props.asset} />
        ) : (
          <FetchedAssetEmbed {...props} />
        )
      ) : (
        <AssetEmbedPlaceholder preview={props.asset?.preview} />
      )}
    </div>
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
      className="max-h-[36rem] w-full rounded-xl bg-muted object-contain"
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

function AssetEmbedPlaceholder({ preview }: { preview?: AssetPreview['preview'] }) {
  return (
    <div
      style={{ aspectRatio: preview ? `${preview.width} / ${preview.height}` : undefined }}
      className="flex aspect-video max-h-[36rem] items-center justify-center rounded-xl bg-muted text-muted-foreground text-sm"
      role="status"
    >
      Loading media…
    </div>
  );
}
