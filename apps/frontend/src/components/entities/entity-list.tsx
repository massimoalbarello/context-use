import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { EntitySummary } from '../../queries/entities';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { EntityLink } from './entity-link';

export function EntityList({
  entities,
  filtered = false,
}: {
  entities: EntitySummary[];
  filtered?: boolean;
}) {
  const activeEntityId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'entities' ? resource.readableId : undefined;
    },
  });

  if (entities.length === 0) {
    return (
      <ResourceListEmpty title={filtered ? 'No entities match this search.' : 'No entities yet.'}>
        {filtered
          ? 'Clear or change the keyword search.'
          : 'Create a stable coordinate before mentioning it from a page.'}
      </ResourceListEmpty>
    );
  }

  return (
    <ResourceList className="gap-2">
      {entities.map((entity) => (
        <li key={entity.readableId}>
          <EntityLink
            entity={entity}
            presentation="card"
            active={entity.readableId === activeEntityId}
          />
        </li>
      ))}
    </ResourceList>
  );
}
