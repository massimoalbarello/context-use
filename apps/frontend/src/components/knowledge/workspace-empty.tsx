import { Link } from '@tanstack/react-router';

export function WorkspaceEmpty({
  eyebrow,
  title,
  description,
  createTo,
  createLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  createTo: '/pages/new' | '/entities/new';
  createLabel: string;
}) {
  return (
    <div className="workspace-empty">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="workspace-description">{description}</p>
      <Link className="primary-action" to={createTo}>
        {createLabel}
      </Link>
    </div>
  );
}
