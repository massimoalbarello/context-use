import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { FileInput, FileText, History, Image, Users } from 'lucide-react';
import { InfiniteScrollTrigger } from '../components/knowledge/infinite-scroll-trigger';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  type HistoryEntry,
  type HistoryResourceType,
  historyQueryOptions,
} from '../queries/history';

export const Route = createFileRoute('/app/history')({
  validateSearch: (search: Record<string, unknown>): { resourceType?: HistoryResourceType } => ({
    resourceType:
      typeof search.resourceType === 'string' && Object.hasOwn(resources, search.resourceType)
        ? (search.resourceType as HistoryResourceType)
        : undefined,
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/app/login', search: { redirect: location.href } });
    }
  },
  component: HistoryRoute,
});

const resources = {
  entity: { label: 'Entity', plural: 'Entities', icon: Users, to: '/app/entities/$id' },
  page: { label: 'Page', plural: 'Pages', icon: FileText, to: '/app/pages/$id' },
  asset: { label: 'Asset', plural: 'Assets', icon: Image, to: '/app/assets/$id' },
  record: { label: 'Record', plural: 'Records', icon: FileInput, to: '/app/records/$id' },
} as const;
const actions = {
  created: { label: 'Created', className: 'bg-diff-added/10 text-diff-added' },
  updated: { label: 'Updated', className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  unarchived: { label: 'Unarchived', className: 'bg-diff-added/10 text-diff-added' },
  archived: { label: 'Archived', className: 'bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  deleted: { label: 'Deleted', className: 'bg-diff-removed/10 text-diff-removed' },
};

type HistoryItemGroup = { entry: HistoryEntry; revisions: HistoryEntry[] };

function groupDailyHistory(entries: HistoryEntry[]) {
  const items: HistoryItemGroup[] = [];
  const pages = new Map<string, HistoryItemGroup>();
  for (const entry of entries) {
    if (entry.resourceType !== 'page' || entry.pageRevisionNumber === null) {
      items.push({ entry, revisions: [] });
      continue;
    }
    const group = pages.get(entry.readableId);
    if (group) {
      group.revisions.push(entry);
      continue;
    }
    const item = { entry, revisions: [entry] };
    pages.set(entry.readableId, item);
    items.push(item);
  }
  return items;
}

function HistoryTime({ entry }: { entry: HistoryEntry }) {
  return (
    <time
      className="whitespace-nowrap pt-1 text-muted-foreground text-xs tabular-nums"
      dateTime={entry.createdAt.toISOString()}
    >
      {entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}

function HistoryActionBadge({ entry }: { entry: HistoryEntry }) {
  const action = actions[entry.action];
  return (
    <Badge
      className={cn(
        'mt-0.5 rounded-full border-0 px-2.5 py-1 font-semibold text-[10px] uppercase tracking-wide',
        action.className,
      )}
    >
      {action.label}
    </Badge>
  );
}

function HistoryMessage({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="col-span-full min-w-0 sm:col-span-1">
      <p className="break-words text-sm leading-6">{entry.message}</p>
      {entry.clientName !== null && (
        <p className="mt-0.5 text-muted-foreground text-xs">by {entry.clientName}</p>
      )}
    </div>
  );
}

function HistoryItem({ entry, revisions }: HistoryItemGroup) {
  const resource = resources[entry.resourceType];
  const Icon = resource.icon;
  return (
    <li className="flex items-start gap-3 py-4 sm:gap-4">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-5 stroke-[1.5]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="break-words font-semibold text-sm leading-6">
            {entry.available ? (
              <Link
                to={resource.to}
                params={{ id: entry.readableId }}
                search={entry.resourceType === 'page' ? { view: 'revisions' } : {}}
                className="underline-offset-4 hover:underline"
              >
                {entry.name}
              </Link>
            ) : (
              <span>{entry.name}</span>
            )}
          </h3>
          <span className="text-muted-foreground text-xs">{resource.label}</span>
        </div>
        <ol
          aria-label={revisions.length > 0 ? 'Revisions that day' : 'Changes that day'}
          className="mt-3 space-y-3"
        >
          {(revisions.length > 0 ? revisions : [entry]).map((revision) => (
            <li
              key={revision.sequence}
              className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 sm:grid-cols-[auto_auto_1fr]"
            >
              <HistoryTime entry={revision} />
              <HistoryActionBadge entry={revision} />
              <HistoryMessage entry={revision} />
            </li>
          ))}
        </ol>
      </div>
    </li>
  );
}

function HistoryResourceFilter() {
  const { resourceType } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <Select<HistoryResourceType | 'all'>
      value={resourceType ?? 'all'}
      onValueChange={(value) =>
        void navigate({
          search: { resourceType: value === 'all' ? undefined : (value ?? undefined) },
        })
      }
    >
      <SelectTrigger className="w-40" aria-label="Resource type">
        <SelectValue>{resourceType ? resources[resourceType].plural : 'All resources'}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All resources</SelectItem>
        {Object.entries(resources).map(([value, resource]) => (
          <SelectItem key={value} value={value}>
            {resource.plural}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HistoryEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="py-16 text-center">
      <History className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">
        {filtered ? 'No changes for this resource type yet' : 'Your next change starts the story'}
      </h2>
      <p className="mt-2 text-muted-foreground text-sm">
        {filtered
          ? 'Choose another resource type to see more changes.'
          : 'Changes to pages, entities, assets, and records will appear here.'}
      </p>
    </div>
  );
}

function HistoryRoute() {
  const { profile } = Route.useRouteContext();
  const { resourceType } = Route.useSearch();
  const query = useInfiniteQuery(historyQueryOptions(resourceType));
  const days = (query.data?.pages ?? []).flatMap((page) => {
    const first = page.items[0];
    return first ? [{ date: first.createdAt, items: groupDailyHistory(page.items) }] : [];
  });
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
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-semibold text-3xl tracking-tight">History</h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  How your context changes, day by day. Newest first.
                </p>
              </div>
              <HistoryResourceFilter />
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
            ) : days.length === 0 ? (
              <HistoryEmptyState filtered={Boolean(resourceType)} />
            ) : (
              <div className="space-y-8">
                {days.map((day) => (
                  <section
                    key={day.date.toLocaleDateString()}
                    aria-label={day.date.toLocaleDateString([], { dateStyle: 'full' })}
                  >
                    <h2 className="border-border border-b pb-3 font-semibold text-base tracking-tight">
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
                    <ol className="divide-y divide-border/60">
                      {day.items.map((item) => (
                        <HistoryItem key={item.entry.sequence} {...item} />
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
