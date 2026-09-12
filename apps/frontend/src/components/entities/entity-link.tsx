import { ENTITY_TYPE_LABELS } from '@repo/backend/entity';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { EntitySearch } from '../../lib/entity-filters';
import type { EntitySummary } from '../../queries/entities';
import { resourceCardVariants } from '../knowledge/resource-list';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';

type EntityName = Pick<EntitySummary, 'readableId' | 'name'> & {
  image?: EntitySummary['image'];
};
type EntityIdentity = Pick<
  EntitySummary,
  'readableId' | 'name' | 'description' | 'entityType' | 'isSelf'
> & {
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

export function entityInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || '?';
}

export function EntityAvatar({
  entity,
  size,
  className,
}: {
  entity: Pick<EntityIdentity, 'name' | 'image'>;
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
    </>
  );
}

export function EntityLink({ entity, presentation, active, children, search }: EntityLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="relative mx-0.5 inline-block rounded-full bg-muted py-0.5 pr-2 pl-[2.0625rem] align-baseline font-medium text-foreground no-underline transition hover:bg-accent"
        to="/entities/$id"
        params={{ id: entity.readableId }}
        search={search}
      >
        <EntityAvatar
          entity={entity}
          size="sm"
          className="absolute top-1/2 left-[0.3125rem] -translate-y-1/2 text-[0.6rem]"
        />
        <span>{children ?? entity.name}</span>
      </Link>
    );
  }

  return (
    <Link
      className={cn(resourceCardVariants(), 'transition')}
      to="/entities/$id"
      params={{ id: entity.readableId }}
      search={search}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <EntityCardContent entity={entity} />
    </Link>
  );
}
