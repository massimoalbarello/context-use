import { useRouterState } from '@tanstack/react-router';
import { knowledgeResourceFromPath } from '../../lib/knowledge-navigation';
import type { KnowledgePageSummary } from '../../queries/pages';
import { ResourceList, ResourceListEmpty } from '../knowledge/resource-list';
import { KnowledgePageLink } from './knowledge-page-link';

function PageGroup({
  title,
  pages,
  activePageId,
}: {
  title: string;
  pages: KnowledgePageSummary[];
  activePageId?: string;
}) {
  if (pages.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={`page-group-${title.toLowerCase().replace(' ', '-')}`}>
      <h2
        className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wider"
        id={`page-group-${title.toLowerCase().replace(' ', '-')}`}
      >
        {title}
      </h2>
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
    </section>
  );
}

export function KnowledgePageList({
  pages,
  time,
}: {
  pages: KnowledgePageSummary[];
  time?: string;
}) {
  const activePageId = useRouterState({
    select: (state) => {
      const resource = knowledgeResourceFromPath(state.location.pathname);
      return resource?.collection === 'pages' ? resource.readableId : undefined;
    },
  });

  if (pages.length === 0) {
    return (
      <ResourceListEmpty title={time ? `No pages overlap ${time}.` : 'No knowledge pages yet.'}>
        {time
          ? 'Clear the subject-time filter or try another point or range.'
          : 'Start with one coherent idea and connect it to the entities it discusses.'}
      </ResourceListEmpty>
    );
  }

  const timeline = pages.filter((page) => page.temporalCoverage !== null);
  const general = pages.filter((page) => page.temporalCoverage === null);

  return (
    <div className="grid gap-2">
      <PageGroup title="Timeline" pages={timeline} activePageId={activePageId} />
      <PageGroup title="General knowledge" pages={general} activePageId={activePageId} />
    </div>
  );
}
