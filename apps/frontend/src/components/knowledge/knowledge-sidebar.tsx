import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function KnowledgeSidebar({
  title,
  count,
  createTo,
  createLabel,
  error,
  children,
}: {
  title: string;
  count: number;
  createTo: '/pages/new' | '/entities/new';
  createLabel: string;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <aside className="knowledge-sidebar">
      <header className="sidebar-header">
        <div>
          <h1>{title}</h1>
          <span className="count-badge">{count}</span>
        </div>
        <Link className="sidebar-create" to={createTo}>
          <span className="create-icon" aria-hidden="true">
            +
          </span>
          {createLabel}
        </Link>
      </header>
      <div className="sidebar-scroll">
        {error ? <p className="error-message sidebar-error">{error.message}</p> : children}
      </div>
    </aside>
  );
}
