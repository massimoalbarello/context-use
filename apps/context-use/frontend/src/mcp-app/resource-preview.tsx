import { useQuery } from '@tanstack/react-query';
import { ENTITY_TYPE_LABELS } from '#backend/models/entities/model.ts';
import { AssetImage, AssetPreviewContent } from '../components/assets/asset-preview-content';
import { EntityAvatar } from '../components/entities/entity-link';
import { EntityPageSections } from '../components/entities/entity-page-sections';
import { EntityProfile } from '../components/entities/entity-profile';
import { resourceCardVariants } from '../components/knowledge/resource-list';
import { KnowledgePageCardContent } from '../components/pages/knowledge-page-link';
import { isEmbeddableAsset } from '../lib/asset-presentation';
import type { Asset, Entity, PagesClient } from './client';

function previewQuery({ client, address }: { client: PagesClient; address: string }) {
  return {
    queryKey: ['mcp-image', address],
    queryFn: () => client.image(address),
    staleTime: Infinity,
  };
}
export function PreviewPortrait({
  client,
  address,
  name,
  size,
  className,
}: {
  client: PagesClient;
  address: string;
  name: string;
  size?: 'sm';
  className?: string;
}) {
  const image = useQuery(previewQuery({ client, address }));
  return <EntityAvatar entity={{ name }} imageSrc={image.data} size={size} className={className} />;
}
export function PreviewImage({
  client,
  address,
  alt,
  className,
}: {
  client: PagesClient;
  address: string;
  alt: string;
  className?: string;
}) {
  const image = useQuery(previewQuery({ client, address }));
  if (!image.data) {
    return (
      <span className="text-muted-foreground text-sm">
        {image.isPending ? 'Loading image…' : 'Image preview unavailable.'}
      </span>
    );
  }
  return <AssetImage src={image.data} alt={alt} className={className} />;
}

export function EntityPreview({
  entity,
  client,
  onOpen,
}: {
  entity: Entity;
  client: PagesClient;
  onOpen: (address: string) => void;
}) {
  return (
    <section className="grid gap-5">
      <p className="text-muted-foreground text-sm">
        {entity.entityType ? ENTITY_TYPE_LABELS[entity.entityType] : 'Entity'}
      </p>
      <EntityProfile
        entity={entity}
        portrait={
          entity.imageAddress ? (
            <button
              type="button"
              aria-label={`Open portrait of ${entity.name}`}
              onClick={() => onOpen(entity.imageAddress!)}
            >
              <PreviewPortrait
                client={client}
                address={entity.imageAddress}
                name={entity.name}
                className="size-24 rounded-full object-cover"
              />
            </button>
          ) : (
            <EntityAvatar entity={entity} className="size-24 text-3xl" />
          )
        }
      />
      {entity.pages.length > 0 && (
        <EntityPageSections
          pages={entity.pages}
          renderPage={(page) => (
            <button
              type="button"
              className={resourceCardVariants({ className: 'w-full' })}
              onClick={() => onOpen(page.address)}
            >
              <KnowledgePageCardContent page={page} />
            </button>
          )}
        />
      )}
    </section>
  );
}

export function AssetPreview({ asset, client }: { asset: Asset; client: PagesClient }) {
  return (
    <AssetPreviewContent asset={asset} heading="h1">
      {isEmbeddableAsset(asset) && (
        <PreviewImage
          address={asset.address}
          alt={asset.name}
          client={client}
          className="max-h-[36rem] w-full rounded-xl bg-muted object-contain"
        />
      )}
    </AssetPreviewContent>
  );
}
