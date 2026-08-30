import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { KnowledgePageSummary } from '../../queries/pages';

type KnowledgePageName = Pick<KnowledgePageSummary, 'readableId' | 'title'>;
type KnowledgePageIdentity = KnowledgePageName & Pick<KnowledgePageSummary, 'excerpt'>;

type KnowledgePageLinkProps =
  | {
      page: KnowledgePageName;
      presentation: 'inline';
      fragment?: string;
      active?: never;
      children?: ReactNode;
    }
  | {
      page: KnowledgePageIdentity;
      presentation: 'card';
      fragment?: string;
      active?: boolean;
      children?: never;
    };

export function KnowledgePageCardContent({
  page,
  fragment,
}: {
  page: KnowledgePageIdentity;
  fragment?: string;
}) {
  return (
    <>
      <span className="knowledge-page-link-mark" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <title>Knowledge page</title>
          <path d="M5 2.75h6.5L15 6.25v11H5z" />
          <path d="M11.5 2.75v3.5H15M7.5 10h5M7.5 13h5" />
        </svg>
      </span>
      <span className="knowledge-page-link-copy">
        <strong>{page.title}</strong>
        {fragment && <span className="knowledge-page-link-fragment">#{fragment}</span>}
        {page.excerpt && <small>{page.excerpt}</small>}
      </span>
    </>
  );
}

export function KnowledgePageLink({
  page,
  presentation,
  fragment,
  active,
  children,
}: KnowledgePageLinkProps) {
  if (presentation === 'inline') {
    return (
      <Link
        className="knowledge-page-link knowledge-page-link-inline object-link"
        to="/pages/$id"
        params={{ id: page.readableId }}
        search={{ view: 'preview' }}
        hash={fragment}
      >
        {children ?? page.title}
      </Link>
    );
  }

  return (
    <Link
      className="knowledge-page-link knowledge-page-link-card resource-card object-link"
      to="/pages/$id"
      params={{ id: page.readableId }}
      search={{ view: 'preview' }}
      hash={fragment}
      activeOptions={{ exact: true, includeSearch: false }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <KnowledgePageCardContent page={page} fragment={fragment} />
    </Link>
  );
}
