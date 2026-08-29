import { Link } from '@tanstack/react-router';
import type { EntitySummary } from '../../queries/entities';

export function EntityList({ entities }: { entities: EntitySummary[] }) {
  if (entities.length === 0) {
    return (
      <div className="empty-state">
        <p>No entities yet.</p>
        <span>Create a stable coordinate before mentioning it from a page.</span>
      </div>
    );
  }

  return (
    <ul className="card-list">
      {entities.map((entity) => (
        <li key={entity.id}>
          <Link to="/entities/$id" params={{ id: entity.readableId }} className="card-link">
            <span>
              <strong>{entity.name}</strong>
              <code>{entity.readableId}</code>
            </span>
            <p>{entity.description}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
