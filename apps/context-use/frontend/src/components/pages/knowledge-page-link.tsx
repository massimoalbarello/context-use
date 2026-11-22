import { cn } from '@repo/ui/class-names';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { resourceCardVariants } from '../knowledge/resource-list';
import { useResourceLink } from '../knowledge/resource-navigation';
import { PublicBadge, UnpublishedRevisionsBadge } from '../publications/publication-appearance';
import {
  hasUnpublishedRevisions,
  KnowledgePageCardContent,
  type KnowledgePageIdentity,
  type KnowledgePageName,
} from './knowledge-page-card-content';

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
      {page.publishedAt != null &&
        (hasUnpublishedRevisions(page) ? (
          <Link
            onClick={revisionsLink.onClick}
            preload={revisionsLink.preload}
            to="/app/pages/$id"
            params={{ id: page.readableId }}
            search={(previous) => ({ ...previous, view: 'revisions' })}
            className="relative z-10 shrink-0 rounded-full hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
          >
            <UnpublishedRevisionsBadge />
          </Link>
        ) : (
          <PublicBadge />
        ))}
    </div>
  );
}
