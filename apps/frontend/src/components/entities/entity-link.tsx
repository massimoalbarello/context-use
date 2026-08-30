import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { EntitySummary } from '../../queries/entities';

type EntityName = Pick<EntitySummary, 'readableId' | 'name'>;
type EntityIdentity = Pick<EntitySummary, 'readableId' | 'name' | 'description' | 'isSelf'>;

type EntityLinkProps =
  | { entity: EntityName; presentation: 'inline'; children?: ReactNode }
  | { entity: EntityIdentity; presentation: 'card'; children?: never };

export function entityInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || '?';
}

export function EntityCardContent({ entity }: { entity: EntityIdentity }) {
  return (
    <>
      <span className="entity-link-avatar" aria-hidden="true">
        {entityInitial(entity.name)}
      </span>
      <span className="entity-link-copy">
        <span className="entity-link-name">
          <strong>{entity.name}</strong>
          {entity.isSelf && <span className="self-badge">You</span>}
        </span>
        <small>{entity.description}</small>
      </span>
    </>
  );
}

export function EntityLink({ entity, presentation, children }: EntityLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="entity-link entity-link-inline object-link"
        to="/entities/$id"
        params={{ id: entity.readableId }}
      >
        <span className="entity-link-avatar" aria-hidden="true">
          {entityInitial(entity.name)}
        </span>
        <span>{children ?? entity.name}</span>
      </Link>
    );
  }

  return (
    <Link
      className="entity-link entity-link-card resource-card object-link"
      to="/entities/$id"
      params={{ id: entity.readableId }}
    >
      <EntityCardContent entity={entity} />
    </Link>
  );
}
