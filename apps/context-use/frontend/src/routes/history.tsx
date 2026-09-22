import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@repo/ui/button';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { ChevronDown, FileInput, FileText, History, Image, RefreshCw, Users } from 'lucide-react';
import { EntityAvatar } from '../components/entities/entity-link';
import { InfiniteScrollTrigger } from '../components/knowledge/infinite-scroll-trigger';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { KnowledgePageRevisionComparison } from '../components/pages/knowledge-page-revision-comparison';
import { type HistoryEntry, historyQueryOptions } from '../queries/history';

export const Route = createFileRoute('/history')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: HistoryRoute,
});

const resources = {
  entity: { label: 'Entity', icon: Users, to: '/entities/$id' },
  page: { label: 'Page', icon: FileText, to: '/pages/$id' },
  asset: { label: 'Asset', icon: Image, to: '/assets/$id' },
  record: { label: 'Record', icon: FileInput, to: '/records/$id' },
} as const;
const actions = { created: 'Added', updated: 'Updated', archived: 'Archived', deleted: 'Deleted' };

function ChangeDetails({ details }: { details: string[] }) {
  if (!details.length) {
    return null;
  }
  return (
    <ul className="space-y-1 border-border border-l-2 pl-3 text-muted-foreground text-xs leading-5">
      {details.map((detail) => (
        <li className="break-words" key={detail}>
          {detail}
        </li>
      ))}
    </ul>
  );
}

function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const resource = resources[entry.resourceType];
  const Icon = resource.icon;
  return (
    <li className="relative pb-10 pl-11 last:pb-0">
      <span className="absolute top-0 left-0 grid size-7 place-items-center rounded-full bg-muted text-muted-foreground">
        {entry.resourceType === 'entity' ? (
          <EntityAvatar entity={{ name: entry.name, image: null }} className="size-7 text-xs" />
        ) : (
          <Icon className="size-3.5" aria-hidden="true" />
        )}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-muted-foreground text-xs">
        <span className="font-medium">
          {actions[entry.action]} {resource.label.toLowerCase()}
        </span>
        {entry.clientName !== null && <span>by {entry.clientName}</span>}
        <time className="ml-auto tabular-nums" dateTime={entry.createdAt.toISOString()}>
          {entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <h3 className="mt-1.5 break-words font-semibold text-lg leading-snug tracking-tight">
        {entry.available ? (
          <Link
            to={resource.to}
            params={{ id: entry.readableId }}
            search={{}}
            className="underline-offset-4 hover:underline"
          >
            {entry.name}
          </Link>
        ) : (
          <span>{entry.name}</span>
        )}
      </h3>
      <p className="mt-3 break-words text-sm leading-6">{entry.message}</p>
      {entry.resourceType !== 'page' && entry.details.length > 0 && (
        <div className="mt-3">
          <ChangeDetails details={entry.details} />
        </div>
      )}
      {entry.resourceType === 'page' && entry.pageRevisionNumber !== null && entry.available && (
        <Collapsible.Root className="mt-2">
          <Collapsible.Trigger
            render={<Button variant="ghost" size="sm" />}
            className="group -ml-2"
          >
            View changes{' '}
            <ChevronDown className="size-3.5 group-data-panel-open:rotate-180" aria-hidden="true" />
          </Collapsible.Trigger>
          <Collapsible.Panel className="space-y-4 pt-3">
            <ChangeDetails details={entry.details} />
            <KnowledgePageRevisionComparison
              readableId={entry.readableId}
              revisionNumber={entry.pageRevisionNumber}
            />
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
    </li>
  );
}

function HistoryRoute() {
  const { profile } = Route.useRouteContext();
  const query = useInfiniteQuery(historyQueryOptions);
  const days = new Map<string, { date: Date; entries: HistoryEntry[] }>();
  for (const page of query.data?.pages ?? []) {
    for (const entry of page.items) {
      const key = entry.createdAt.toLocaleDateString();
      const group = days.get(key) ?? { date: entry.createdAt, entries: [] };
      group.entries.push(entry);
      days.set(key, group);
    }
  }
  if (!profile) {
    return null;
  }
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 pt-20 pb-10 md:px-10"
          data-collection-scroll
        >
          <div className="mx-auto w-full max-w-3xl">
            <header className="mb-10 flex items-start justify-between gap-4">
              <div>
                <h1 className="font-semibold text-3xl tracking-tight">History</h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  How your context changes, day by day. Newest first.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh history"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                <RefreshCw className="size-4" />
              </Button>
            </header>
            {query.isPending ? (
              <p role="status" className="text-muted-foreground text-sm">
                Loading history…
              </p>
            ) : query.isError && !query.data ? (
              <div role="alert">
                <p>Couldn’t load history.</p>
                <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              </div>
            ) : days.size === 0 ? (
              <div className="py-16 text-center">
                <History className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="font-medium">Your next change starts the story</h2>
                <p className="mt-2 text-muted-foreground text-sm">
                  Changes to pages, entities, assets, and records will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-12">
                {Array.from(days, ([key, day]) => (
                  <section
                    key={key}
                    aria-label={day.date.toLocaleDateString([], { dateStyle: 'full' })}
                  >
                    <h2 className="mb-7 font-semibold text-xl tracking-tight">
                      <time
                        dateTime={`${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}-${String(day.date.getDate()).padStart(2, '0')}`}
                      >
                        {day.date.toLocaleDateString([], {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </time>
                    </h2>
                    <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-px before:bg-border">
                      {day.entries.map((entry) => (
                        <HistoryItem key={entry.sequence} entry={entry} />
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
            <InfiniteScrollTrigger
              hasNextPage={query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              error={query.isFetchNextPageError ? query.error : null}
              loadMore={() => query.fetchNextPage({ cancelRefetch: false })}
            />
          </div>
        </div>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
