import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '../../lib/class-names';
import type { EntitySummary } from '../../queries/entities';
import { resourceCardVariants } from '../knowledge/resource-list';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';

type EntityName = Pick<EntitySummary, 'readableId' | 'name'>;
type EntityIdentity = Pick<EntitySummary, 'readableId' | 'name' | 'description' | 'isSelf'>;

type EntityLinkProps =
  | { entity: EntityName; presentation: 'inline'; active?: never; children?: ReactNode }
  | { entity: EntityIdentity; presentation: 'card'; active?: boolean; children?: never };

export function entityInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || '?';
}

export function EntityCardContent({ entity }: { entity: EntityIdentity }) {
  return (
    <>
      <Avatar className="size-9 font-semibold text-xs uppercase" aria-hidden="true">
        <AvatarFallback>{entityInitial(entity.name)}</AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 truncate font-semibold text-sm">{entity.name}</strong>
          {entity.isSelf && <Badge variant="secondary">You</Badge>}
        </span>
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          {entity.description}
        </small>
      </span>
    </>
  );
}

export function EntityLink({ entity, presentation, active, children }: EntityLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-2 pl-[0.3125rem] align-baseline font-medium text-foreground no-underline transition hover:bg-accent"
        to="/entities/$id"
        params={{ id: entity.readableId }}
      >
        <Avatar size="sm" className="font-semibold text-[0.6rem] uppercase" aria-hidden="true">
          <AvatarFallback>{entityInitial(entity.name)}</AvatarFallback>
        </Avatar>
        <span>{children ?? entity.name}</span>
      </Link>
    );
  }

  return (
    <Link
      className={cn(resourceCardVariants(), 'transition')}
      to="/entities/$id"
      params={{ id: entity.readableId }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <EntityCardContent entity={entity} />
    </Link>
  );
}
