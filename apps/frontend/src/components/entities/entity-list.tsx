import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { EntitySummary } from '../../queries/entities';
import { EntityLink } from './entity-link';

export function EntityList({ entities }: { entities: EntitySummary[] }) {
  const activeEntityId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'entities' ? resource.readableId : undefined;
    },
  });

  if (entities.length === 0) {
    return (
      <div className="empty-state">
        <p>No entities yet.</p>
        <span>Create a stable coordinate before mentioning it from a page.</span>
      </div>
    );
  }

  return (
    <ul className="entity-card-list object-card-list">
      {entities.map((entity) => (
        <li key={entity.id}>
          <EntityLink
            entity={entity}
            presentation="card"
            active={entity.readableId === activeEntityId}
          />
        </li>
      ))}
    </ul>
  );
}
