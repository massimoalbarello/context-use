import { Link } from '@tanstack/react-router';
import { File, Image as ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { AssetSummary } from '../../queries/assets';
import { resourceCardVariants } from '../knowledge/resource-list';

const BYTES_PER_KIBIBYTE = 1024;
const KIBIBYTES_PER_MEBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * KIBIBYTES_PER_MEBIBYTE;

type AssetName = Pick<AssetSummary, 'readableId' | 'name'>;
type AssetIdentity = Pick<
  AssetSummary,
  'id' | 'readableId' | 'name' | 'mediaType' | 'extension' | 'sizeBytes'
>;

type AssetLinkProps =
  | { asset: AssetName; presentation: 'inline'; active?: never; children?: ReactNode }
  | { asset: AssetIdentity; presentation: 'card'; active?: boolean; children?: never };

export function formatAssetSize(sizeBytes: number): string {
  if (sizeBytes < BYTES_PER_KIBIBYTE) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < BYTES_PER_MEBIBYTE) {
    return `${(sizeBytes / BYTES_PER_KIBIBYTE).toFixed(1)} KB`;
  }
  return `${(sizeBytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
}

export function AssetCardContent({ asset }: { asset: AssetIdentity }) {
  const embeddable = isEmbeddableAsset(asset);
  return (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {embeddable ? (
          <img className="size-full object-cover" src={assetContentUrl(asset.readableId)} alt="" />
        ) : (
          <File className="size-5 stroke-[1.4]" aria-hidden="true" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="truncate font-semibold text-sm">{asset.name}</strong>
        <small className="truncate text-muted-foreground text-xs">
          {asset.extension?.toUpperCase() ?? asset.mediaType} · {formatAssetSize(asset.sizeBytes)}
        </small>
      </span>
    </>
  );
}

export function AssetLink({ asset, presentation, active, children }: AssetLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-foreground/35 underline-offset-4"
        to="/assets/$id"
        params={{ id: asset.readableId }}
      >
        <ImageIcon className="size-4" aria-hidden="true" />
        {children ?? asset.name}
      </Link>
    );
  }
  return (
    <Link
      className={cn(resourceCardVariants(), 'transition')}
      to="/assets/$id"
      params={{ id: asset.readableId }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <AssetCardContent asset={asset} />
    </Link>
  );
}
