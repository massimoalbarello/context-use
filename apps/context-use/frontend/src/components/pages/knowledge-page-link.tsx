import { cn } from '@repo/ui/class-names';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KnowledgePageSummary } from '../../queries/pages';
import { resourceCardVariants } from '../knowledge/resource-list';
import { useResourceLink } from '../knowledge/resource-navigation';
import { PublicBadge, UnpublishedRevisionsBadge } from '../publications/publication-appearance';
import { TemporalCoverageLabel } from './temporal-coverage-label';

type KnowledgePageName = Pick<KnowledgePageSummary, 'readableId' | 'title'>;
type KnowledgePageIdentity = KnowledgePageName &
  Pick<KnowledgePageSummary, 'excerpt' | 'temporalCoverage'> &
  Partial<Pick<KnowledgePageSummary, 'publishedAt' | 'publishedRevisionNumber' | 'revisionNumber'>>;

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
  publicationStatus,
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
      {publicationStatus !== undefined
        ? publicationStatus
        : page.publishedAt != null && (
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {page.publishedRevisionNumber != null &&
                page.revisionNumber != null &&
                page.publishedRevisionNumber !== page.revisionNumber && (
                  <UnpublishedRevisionsBadge />
                )}
              <PublicBadge />
            </span>
          )}
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
  const resourceLink = useResourceLink({ kind: 'page', readableId: page.readableId, fragment });
  const revisionsLink = useResourceLink({
    kind: 'page',
    readableId: page.readableId,
    view: 'revisions',
  });
  if (presentation === 'inline') {
    return (
      <Link
        onClick={resourceLink.onClick}
        preload={resourceLink.preload}
        className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 transition hover:decoration-foreground"
        to="/app/pages/$id"
        params={{ id: page.readableId }}
        search={(previous) => ({ ...previous, view: 'preview' })}
        hash={fragment}
      >
        {children ?? page.title}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        resourceCardVariants(),
        'relative h-auto min-h-20 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
      )}
      data-route-selected={(resourceLink.selected ?? active) ? 'true' : undefined}
    >
      <Link
        onClick={resourceLink.onClick}
        preload={resourceLink.preload}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
        to="/app/pages/$id"
        params={{ id: page.readableId }}
        search={(previous) => ({ ...previous, view: 'preview' })}
        hash={fragment}
        activeOptions={{ exact: true, includeSearch: false }}
        aria-current={(resourceLink.selected ?? active) ? 'page' : undefined}
      >
        <KnowledgePageCardContent page={page} fragment={fragment} publicationStatus={null} />
      </Link>
      {page.publishedAt != null && (
        <span className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          {page.publishedRevisionNumber != null &&
            page.revisionNumber != null &&
            page.publishedRevisionNumber !== page.revisionNumber && (
              <Link
                onClick={revisionsLink.onClick}
                preload={revisionsLink.preload}
                to="/app/pages/$id"
                params={{ id: page.readableId }}
                search={(previous) => ({ ...previous, view: 'revisions' })}
                className="relative z-10 rounded-full hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
              >
                <UnpublishedRevisionsBadge />
              </Link>
            )}
          <PublicBadge />
        </span>
      )}
    </div>
  );
}
