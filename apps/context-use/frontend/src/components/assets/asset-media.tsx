import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { assetPreviewKind } from '#backend/models/assets/presentation.ts';
import { assetContentUrl } from '../../lib/asset-presentation';
import { MAX_DOCUMENT_PREVIEW_BYTES } from '../../lib/document-preview';
import { assetDocumentQueryOptions } from '../../queries/assets';
import { AssetDocument } from './asset-document';
import { AssetPlayer } from './asset-player';
import { AssetPreviewFallback } from './asset-preview-fallback';
import { PdfPreviewLoading } from './pdf-preview-loading';

type PreviewableAsset = {
  archivedAt?: Date | null;
  readableId: string;
  name: string;
  mediaType: string;
  sizeBytes?: number;
};

export function AssetMedia(props: {
  asset: PreviewableAsset;
  className: string;
  fallback?: ReactNode;
}) {
  return <AssetMediaContent key={props.asset.readableId} {...props} />;
}

function AssetMediaContent({
  asset,
  className,
  fallback,
}: {
  asset: PreviewableAsset;
  className: string;
  fallback?: ReactNode;
}) {
  const kind = assetPreviewKind(asset.mediaType);
  if (kind === 'document') {
    if ((asset.sizeBytes ?? 0) > MAX_DOCUMENT_PREVIEW_BYTES) {
      return <AssetPreviewFallback message="This file is too large to preview." />;
    }
    return <DocumentPreview asset={asset} />;
  }
  if (kind === 'unsupported') {
    return <AssetPreviewFallback message="Preview isn’t available for this file format." />;
  }
  return (
    <AssetPlayer
      kind={kind}
      name={asset.name}
      src={assetContentUrl({ readableId: asset.readableId, includeArchived: !!asset.archivedAt })}
      className={className}
      fallback={fallback}
    />
  );
}

function DocumentPreview({ asset }: { asset: PreviewableAsset }) {
  const content = useQuery(
    assetDocumentQueryOptions({
      readableId: asset.readableId,
      includeArchived: !!asset.archivedAt,
    }),
  );
  if (content.error) {
    return <AssetPreviewFallback message={content.error.message} />;
  }
  if (!content.data) {
    return asset.mediaType === 'application/pdf' ? (
      <PdfPreviewLoading />
    ) : (
      <p role="status">Loading preview…</p>
    );
  }
  return <AssetDocument bytes={content.data} name={asset.name} mediaType={asset.mediaType} />;
}
