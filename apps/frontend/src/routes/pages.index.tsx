import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import { pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/')({
  loaderDeps: ({ search }) => ({ dateRange: calendarDateRangeFromSearch(search) }),
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
  const dateRange = calendarDateRangeFromSearch(Route.useSearch());
  if (dateRange) {
    return (
      <WorkspaceEmpty
        eyebrow="Knowledge pages"
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
