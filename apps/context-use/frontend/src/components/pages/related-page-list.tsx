import type { ReactNode } from 'react';
import { ResourceList } from '../knowledge/resource-list';

export function RelatedPageList<Page extends { readableId: string }>({
  pages,
  renderPage,
}: {
  pages: Page[];
  renderPage: (page: Page) => ReactNode;
}) {
  return (
    <ResourceList>
      {pages.map((page) => (
        <li key={page.readableId}>{renderPage(page)}</li>
      ))}
    </ResourceList>
  );
}
