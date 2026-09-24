import { type ReactNode, useContext } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { ResourceNavigation } from '../knowledge/resource-navigation';
import { AssetLink } from './asset-link';

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

export function AssetMarkdownImage({ readableId, alt }: { readableId: string; alt?: string }) {
  return (
    <img
      className="my-7 max-h-[36rem] w-full rounded-xl bg-muted object-contain"
      src={assetContentUrl(readableId)}
      alt={alt ?? ''}
    />
  );
}
