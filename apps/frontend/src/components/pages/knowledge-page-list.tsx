import type { KnowledgePageSummary } from '../../queries/pages';
import { KnowledgePageLink } from './knowledge-page-link';

export function KnowledgePageList({ pages }: { pages: KnowledgePageSummary[] }) {
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
          <KnowledgePageLink page={page} presentation="card" />
        </li>
      ))}
    </ul>
  );
}
