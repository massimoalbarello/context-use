import { cn } from '@repo/ui/class-names';
import { entityInitial, InlineEntity } from '@repo/ui/inline-entity';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ENTITY_TYPE_LABELS } from '#backend/models/entities/model.ts';
import { assetContentUrl } from '../../lib/asset-presentation';
import type { EntitySearch } from '../../lib/entity-filters';
import type { EntitySummary } from '../../queries/entities';
import { resourceCardVariants } from '../knowledge/resource-list';
import { useResourceLink } from '../knowledge/resource-navigation';
import { PublicBadge } from '../publications/publication-appearance';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';

type EntityName = Pick<EntitySummary, 'readableId' | 'name'> & {
  image?: EntitySummary['image'];
};
type EntityIdentity = Pick<
  EntitySummary,
  'readableId' | 'name' | 'description' | 'entityType' | 'isSelf'
> &
  Partial<Pick<EntitySummary, 'publishedAt'>> & {
    image?: EntitySummary['image'];
  };

type EntityLinkProps =
  | {
      search?: EntitySearch;
      entity: EntityName;
      presentation: 'inline';
      active?: never;
      children?: ReactNode;
    }
  | {
      search?: EntitySearch;
      entity: EntityIdentity;
      presentation: 'card';
      active?: boolean;
      children?: never;
    };

export function EntityAvatar({
  entity,
  size,
  className,
}: {
  entity: { name: string; image?: { readableId: string } | null };
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}) {
  return (
    <Avatar
      size={size}
      className={cn('font-semibold text-xs uppercase', className)}
      aria-hidden="true"
    >
      {entity.image && <AvatarImage src={assetContentUrl(entity.image.readableId)} alt="" />}
      <AvatarFallback>{entityInitial(entity.name)}</AvatarFallback>
    </Avatar>
  );
}

export function EntityCardContent({ entity }: { entity: EntityIdentity }) {
  return (
    <>
      <EntityAvatar entity={entity} className="size-9" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 truncate font-semibold text-sm">{entity.name}</strong>
          {entity.isSelf && <Badge variant="secondary">You</Badge>}
        </span>
        {entity.entityType && (
          <small className="text-muted-foreground text-xs">
            {ENTITY_TYPE_LABELS[entity.entityType]}
          </small>
        )}
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          {entity.description}
        </small>
      </span>
      {entity.publishedAt != null && <PublicBadge />}
    </>
  );
}

export function EntityLink({ entity, presentation, active, children, search }: EntityLinkProps) {
  const resourceLink = useResourceLink({ kind: 'entity', readableId: entity.readableId });
  if (presentation === 'inline') {
    return (
      <Link
        onClick={resourceLink.onClick}
        preload={resourceLink.preload}
        className="group/entity text-inherit no-underline"
        to="/app/entities/$id"
        params={{ id: entity.readableId }}
        search={search}
      >
        <InlineEntity name={entity.name} avatar={<EntityAvatar entity={entity} size="sm" />}>
          {children}
        </InlineEntity>
      </Link>
    );
  }

  return (
    <Link
      onClick={resourceLink.onClick}
      preload={resourceLink.preload}
      className={cn(resourceCardVariants(), 'transition')}
      to="/app/entities/$id"
      params={{ id: entity.readableId }}
      search={search}
      data-route-selected={(resourceLink.selected ?? active) ? 'true' : undefined}
      aria-current={(resourceLink.selected ?? active) ? 'page' : undefined}
    >
      <EntityCardContent entity={entity} />
    </Link>
  );
}
