import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { KnowledgePageSummary } from '../../queries/pages';

type KnowledgePageIdentity = Pick<KnowledgePageSummary, 'readableId' | 'title'>;

export function KnowledgePageLink({
  page,
  presentation,
  fragment,
  children,
}: {
  page: KnowledgePageIdentity;
  presentation: 'inline' | 'card';
  fragment?: string;
  children?: ReactNode;
}) {
  if (presentation === 'inline') {
    return (
      <Link
        className="knowledge-page-link knowledge-page-link-inline object-link"
        to="/pages/$id"
        params={{ id: page.readableId }}
        hash={fragment}
      >
        {children ?? page.title}
      </Link>
    );
  }

  return (
    <Link
      className="knowledge-page-link knowledge-page-link-card object-link object-link-card"
      to="/pages/$id"
      params={{ id: page.readableId }}
    >
      <span className="knowledge-page-link-mark" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <title>Knowledge page</title>
          <path d="M5 2.75h6.5L15 6.25v11H5z" />
          <path d="M11.5 2.75v3.5H15M7.5 10h5M7.5 13h5" />
        </svg>
      </span>
      <strong>{page.title}</strong>
    </Link>
  );
}
