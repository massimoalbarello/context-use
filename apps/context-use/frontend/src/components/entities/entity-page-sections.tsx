import type { ReactNode } from 'react';
import { RelatedPageList } from '../knowledge/resource-list';
import { Badge } from '../ui/badge';

export function EntityPageSections<Page extends { readableId: string }>({
  pages,
  renderPage,
}: {
  pages: Page[];
  renderPage: (page: Page) => ReactNode;
}) {
  return (
    <section className="scroll-mt-24 pt-2" id="mentioned-by" tabIndex={-1}>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Mentioned by</h2>
        <Badge variant="secondary">{pages.length}</Badge>
      </div>
      {pages.length > 0 ? (
        <RelatedPageList pages={pages} renderPage={renderPage} />
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None yet.</p>
      )}
    </section>
  );
}
