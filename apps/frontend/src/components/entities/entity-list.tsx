import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { EntitySummary } from '../../queries/entities';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
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
      <ResourceListEmpty title="No entities yet.">
        Create a stable coordinate before mentioning it from a page.
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
