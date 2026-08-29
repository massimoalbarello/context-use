import { Link } from '@tanstack/react-router';
import type { KnowledgePageSummary } from '../../queries/pages';

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
    <ul className="card-list">
      {pages.map((page) => (
        <li key={page.id}>
          <Link to="/pages/$id" params={{ id: page.readableId }} className="card-link">
            <span>
              <strong>{page.title}</strong>
              <code>{page.readableId}</code>
            </span>
            <p>
              Revision {page.revisionNumber} · updated {page.updatedAt.toLocaleDateString()}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
