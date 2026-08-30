import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
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
        <FileText />
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
