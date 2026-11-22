import { FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KnowledgePageSummary } from '../../queries/pages';
import { PublicBadge, UnpublishedRevisionsBadge } from '../publications/publication-appearance';
import { Badge } from '../ui/badge';
import { TemporalCoverageLabel } from './temporal-coverage-label';

export type KnowledgePageName = Pick<KnowledgePageSummary, 'readableId' | 'title'>;
export type KnowledgePageIdentity = KnowledgePageName &
  Pick<KnowledgePageSummary, 'excerpt' | 'temporalCoverage'> &
  Partial<
    Pick<
      KnowledgePageSummary,
      'archivedAt' | 'publishedAt' | 'publishedRevisionNumber' | 'revisionNumber'
    >
  >;

type PageRevisions = Pick<KnowledgePageIdentity, 'revisionNumber' | 'publishedRevisionNumber'>;

export function hasUnpublishedRevisions({
  revisionNumber,
  publishedRevisionNumber,
}: PageRevisions) {
  return (
    revisionNumber != null &&
    publishedRevisionNumber != null &&
    publishedRevisionNumber !== revisionNumber
  );
}

export function PageRevisionBadge(props: PageRevisions) {
  return hasUnpublishedRevisions(props) ? <UnpublishedRevisionsBadge /> : <PublicBadge />;
}

export function KnowledgePageCardContent({
  page,
  fragment,
  publicationStatus = page.publishedAt != null && <PageRevisionBadge {...page} />,
}: {
  page: KnowledgePageIdentity;
  fragment?: string;
  publicationStatus?: ReactNode;
}) {
  return (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <FileText className="size-5 fill-none stroke-[1.4] stroke-current" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong className="min-w-0 truncate font-semibold text-sm leading-snug">
          {page.title}
        </strong>
        {fragment && (
          <span className="truncate font-mono text-[0.68rem] text-muted-foreground">
            #{fragment}
          </span>
        )}
        {page.temporalCoverage && (
          <TemporalCoverageLabel
            className="w-fit max-w-full text-xs"
            expression={page.temporalCoverage}
          />
        )}
        {page.excerpt && (
          <small className="truncate text-muted-foreground text-xs leading-relaxed">
            {page.excerpt}
          </small>
        )}
      </span>
      {page.archivedAt && <Badge variant="secondary">Archived</Badge>}
      {publicationStatus}
    </>
  );
}
