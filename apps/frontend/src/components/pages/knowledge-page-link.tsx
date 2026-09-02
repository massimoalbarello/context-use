import { Link } from '@tanstack/react-router';
import { CalendarRange, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/class-names';
import type { KnowledgePageSummary } from '../../queries/pages';
import { resourceCardVariants } from '../knowledge/resource-list';
import { TemporalCoverageLabel } from './temporal-coverage-label';

type KnowledgePageName = Pick<KnowledgePageSummary, 'readableId' | 'title'>;
type KnowledgePageIdentity = KnowledgePageName &
  Pick<KnowledgePageSummary, 'excerpt' | 'temporalCoverage'>;

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
  const temporal = page.temporalCoverage !== null;
  const ResourceIcon = temporal ? CalendarRange : FileText;
  return (
    <>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
          temporal && 'bg-primary/10 text-primary',
        )}
        aria-hidden="true"
      >
        <ResourceIcon className="size-5 fill-none stroke-[1.4] stroke-current" />
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
        className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 transition hover:decoration-foreground"
        to="/pages/$id"
        params={{ id: page.readableId }}
        search={(previous) => ({ ...previous, view: 'preview' })}
        hash={fragment}
      >
        {children ?? page.title}
      </Link>
    );
  }

  return (
    <Link
      className={cn(resourceCardVariants(), 'h-auto min-h-20 transition')}
      to="/pages/$id"
      params={{ id: page.readableId }}
      search={(previous) => ({ ...previous, view: 'preview' })}
      hash={fragment}
      activeOptions={{ exact: true, includeSearch: false }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <KnowledgePageCardContent page={page} fragment={fragment} />
    </Link>
  );
}
