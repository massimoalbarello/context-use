import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import type { CalendarDateRange } from '../lib/temporal-coverage';
import { pagesQueryOptions } from '../queries/pages';

function dateRangeFrom(search: Partial<CalendarDateRange>): CalendarDateRange | undefined {
  return search.from && search.to ? { from: search.from, to: search.to } : undefined;
}

export const Route = createFileRoute('/pages/')({
  loaderDeps: ({ search }) => ({ dateRange: dateRangeFrom(search) }),
  loader: async ({ context, deps }) => {
    const pages = await context.queryClient.ensureInfiniteQueryData(
      pagesQueryOptions(deps.dateRange),
    );
    const firstPage = pages.pages[0]?.items[0];
    if (firstPage) {
      throw redirect({
        to: '/pages/$id',
        params: { id: firstPage.readableId },
        search: { from: deps.dateRange?.from, to: deps.dateRange?.to, view: 'preview' },
      });
    }
  },
  component: PagesIndexRoute,
});

function PagesIndexRoute() {
  const dateRange = dateRangeFrom(Route.useSearch());
  if (dateRange) {
    return (
      <WorkspaceEmpty
        eyebrow="Timeline"
        title="No pages for this date range"
        description="Clear the date range in the sidebar or choose another one."
        createTo="/pages/new"
        createLabel="Create a page"
      />
    );
  }
  return (
    <WorkspaceEmpty
      eyebrow="Hypermedia"
      title="Start with one focused page"
      description="Write one coherent account. You can connect it to your entity and expand the hypermedia from there."
      createTo="/pages/new"
      createLabel="Create the first page"
    />
  );
}
