import type { EntitySummary } from '../../queries/entities';
import { EntityLink } from './entity-link';

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
    <ul className="entity-card-list object-card-list">
      {entities.map((entity) => (
        <li key={entity.id}>
          <EntityLink entity={entity} presentation="card" />
        </li>
      ))}
    </ul>
  );
}
