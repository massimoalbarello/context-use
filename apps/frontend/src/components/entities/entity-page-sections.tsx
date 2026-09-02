import type { EntityDetail } from '../../queries/entities';
import { ResourceList } from '../knowledge/resource-list';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { Badge } from '../ui/badge';

export function EntityPageSections({ pages }: { pages: EntityDetail['pages'] }) {
  const temporalPages = pages.filter((page) => page.temporalCoverage !== null);
  const semanticPages = pages.filter((page) => page.temporalCoverage === null);

  return (
    <section className="scroll-mt-24 pt-2" id="mentioned-by" tabIndex={-1}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Mentioned by</h2>
        <Badge variant="secondary">{pages.length}</Badge>
      </div>
      {pages.length > 0 ? (
        <div className="grid gap-7 md:grid-cols-2">
          {[
            { title: 'Temporal', pages: temporalPages },
            { title: 'Semantic', pages: semanticPages },
          ].map(({ title, pages: sectionPages }) => (
            <section key={title}>
              <h3 className="mb-2 font-medium text-muted-foreground text-sm">{title}</h3>
              {sectionPages.length > 0 ? (
                <ResourceList>
                  {sectionPages.map((page) => (
                    <li key={page.readableId}>
                      <KnowledgePageLink page={page} presentation="card" />
                    </li>
                  ))}
                </ResourceList>
              ) : (
                <p className="text-muted-foreground text-sm">None yet.</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}
