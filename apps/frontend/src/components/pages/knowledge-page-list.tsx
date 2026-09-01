import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { KnowledgePageSummary } from '../../queries/pages';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { KnowledgePageLink } from './knowledge-page-link';

export function KnowledgePageList({ pages }: { pages: KnowledgePageSummary[] }) {
  const activePageId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'pages' ? resource.readableId : undefined;
    },
  });

  if (pages.length === 0) {
    return (
      <ResourceListEmpty title="No knowledge pages yet.">
        Start with one coherent idea and connect it to the entities it discusses.
      </ResourceListEmpty>
    );
  }

  return (
    <ResourceList className="gap-2">
      {pages.map((page) => (
        <li key={page.readableId}>
          <KnowledgePageLink
            page={page}
            presentation="card"
            active={page.readableId === activePageId}
          />
        </li>
      ))}
    </ResourceList>
  );
}
