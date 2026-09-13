import type { EntityDetail } from '../../queries/entities';
import { ResourceList } from '../knowledge/resource-list';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { Badge } from '../ui/badge';

export function EntityPageSections({ pages }: { pages: EntityDetail['pages'] }) {
  return (
    <section className="scroll-mt-24 pt-2" id="mentioned-by" tabIndex={-1}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Mentioned by</h2>
        <Badge variant="secondary">{pages.length}</Badge>
      </div>
      {pages.length > 0 ? (
        <ResourceList>
          {pages.map((page) => (
            <li key={page.readableId}>
              <KnowledgePageLink page={page} presentation="card" />
            </li>
          ))}
        </ResourceList>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}
