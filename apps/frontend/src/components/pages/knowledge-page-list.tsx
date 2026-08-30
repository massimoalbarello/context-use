import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { KnowledgePageSummary } from '../../queries/pages';
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
      <div className="empty-state">
        <p>No knowledge pages yet.</p>
        <span>Start with one coherent idea and connect it to the entities it discusses.</span>
      </div>
    );
  }

  return (
    <ul className="knowledge-page-card-list object-card-list">
      {pages.map((page) => (
        <li key={page.id}>
          <KnowledgePageLink
            page={page}
            presentation="card"
            active={page.readableId === activePageId}
          />
        </li>
      ))}
    </ul>
  );
}
