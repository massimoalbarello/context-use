import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { EntitySummary } from '../../queries/entities';
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
      <Avatar className="entity-link-avatar" aria-hidden="true">
        <AvatarFallback>{entityInitial(entity.name)}</AvatarFallback>
      </Avatar>
      <span className="entity-link-copy">
        <span className="entity-link-name">
          <strong>{entity.name}</strong>
          {entity.isSelf && <Badge variant="secondary">You</Badge>}
        </span>
        <small>{entity.description}</small>
      </span>
    </>
  );
}

export function EntityLink({ entity, presentation, active, children }: EntityLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="entity-link entity-link-inline object-link"
        to="/entities/$id"
        params={{ id: entity.readableId }}
      >
        <Avatar size="sm" className="entity-link-avatar" aria-hidden="true">
          <AvatarFallback>{entityInitial(entity.name)}</AvatarFallback>
        </Avatar>
        <span>{children ?? entity.name}</span>
      </Link>
    );
  }

  return (
    <Link
      className="entity-link entity-link-card resource-card object-link"
      to="/entities/$id"
      params={{ id: entity.readableId }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <EntityCardContent entity={entity} />
    </Link>
  );
}
