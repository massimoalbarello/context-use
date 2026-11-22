import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { assetPreviewKind } from '#backend/models/assets/presentation.ts';
import { AssetDocument } from '../components/assets/asset-document';
import { AssetPlayer } from '../components/assets/asset-player';
import { AssetPreviewContent } from '../components/assets/asset-preview-content';
import { AssetPreviewFallback } from '../components/assets/asset-preview-fallback';
import { documentPreviewBytes, MAX_DOCUMENT_PREVIEW_BYTES } from '../lib/document-preview';
import type { Asset, McpAppClient } from './client';
import { resourceQueryKey } from './queries';

type AssetResult = Awaited<ReturnType<McpAppClient['readAsset']>>;

function PreviewMessage({ message }: { message: string }) {
  return <AssetPreviewFallback message={message}>{false}</AssetPreviewFallback>;
}

function BlobPlayer({
  blob,
  kind,
  name,
  className,
}: {
  blob: Blob;
  kind: 'audio' | 'video';
  name: string;
  className: string;
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return src ? (
    <AssetPlayer
      kind={kind}
      src={src}
      name={name}
      className={className}
      fallback={<PreviewMessage message="This file could not be played." />}
    />
  ) : null;
}

function DownloadPreview({
  asset,
  kind,
  client,
  className,
}: {
  asset: Asset;
  kind: 'document' | 'audio' | 'video';
  client: McpAppClient;
  className: string;
}) {
  const query = useQuery({
    queryKey: [...resourceQueryKey(asset.address), 'content', kind],
    queryFn: async ({ signal }) => {
      const { response, origin } = await client.downloadAsset({ address: asset.address, signal });
      if (kind === 'document') {
        return { kind, bytes: await documentPreviewBytes(response), origin } as const;
      }
      return { kind, blob: await response.blob() } as const;
    },
    staleTime: Infinity,
    retry: false,
  });
  if (query.error) {
    return <PreviewMessage message={query.error.message} />;
  }
  if (!query.data) {
    return <p role="status">Loading preview…</p>;
  }
  return query.data.kind === 'document' ? (
    <AssetDocument
      bytes={query.data.bytes}
      mediaType={asset.mediaType}
      name={asset.name}
      pdfOrigin={query.data.origin}
    />
  ) : (
    <BlobPlayer
      blob={query.data.blob}
      kind={query.data.kind}
      name={asset.name}
      className={className}
    />
  );
}

function PreviewMedia({
  result,
  client,
  alt,
  className,
}: {
  result: AssetResult;
  client: McpAppClient;
  alt?: string;
  className: string;
}) {
  const asset = result.value;
  const kind = assetPreviewKind(asset.mediaType);
  if (kind === 'image') {
    return result.imageSrc ? (
      <AssetPlayer
        kind="image"
        src={result.imageSrc}
        name={alt || asset.name}
        className={className}
        fallback={<PreviewMessage message="Image preview unavailable." />}
      />
    ) : (
      <PreviewMessage message="Image preview unavailable." />
    );
  }
  if (kind === 'unsupported') {
    return <PreviewMessage message="Preview isn’t available for this file format." />;
  }
  if (kind === 'document' && asset.sizeBytes > MAX_DOCUMENT_PREVIEW_BYTES) {
    return <PreviewMessage message="This file is too large to preview." />;
  }
  return <DownloadPreview asset={asset} client={client} className={className} kind={kind} />;
}

export function AssetPreview({ result, client }: { result: AssetResult; client: McpAppClient }) {
  return (
    <AssetPreviewContent asset={result.value} heading="h1">
      <PreviewMedia
        result={result}
        client={client}
        className="max-h-[36rem] w-full rounded-xl bg-muted object-contain"
      />
    </AssetPreviewContent>
  );
}

export function AssetEmbed({
  address,
  client,
  alt,
  linked,
  onOpen,
}: {
  address: string;
  client: McpAppClient;
  alt?: string;
  linked: boolean;
  onOpen?: (address: string) => void;
}) {
  const query = useQuery({
    queryKey: resourceQueryKey(address),
    queryFn: () => client.readAsset(address),
    staleTime: Infinity,
  });
  if (query.error) {
    return <PreviewMessage message={query.error.message} />;
  }
  if (!query.data) {
    return <span role="status">Loading preview…</span>;
  }
  const kind = assetPreviewKind(query.data.value.mediaType);
  const label = alt || query.data.value.name;
  if (linked && kind !== 'image') {
    return <span>{label}</span>;
  }
  const media = (
    <PreviewMedia result={query.data} client={client} alt={label} className="w-full bg-muted" />
  );
  if (linked || !onOpen) {
    return media;
  }
  if (kind === 'image') {
    return (
      <button
        type="button"
        className="block w-full"
        onClick={() => onOpen(address)}
        aria-label={`Open ${label}`}
      >
        {media}
      </button>
    );
  }
  return (
    <>
      {media}
      <button type="button" onClick={() => onOpen(address)}>
        Open {label}
      </button>
    </>
  );
}
