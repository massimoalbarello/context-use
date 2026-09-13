import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { pagesQueryOptions } from '../queries/pages';
import { pageListFilters } from './pages';

export const Route = createFileRoute('/pages/')({
  loaderDeps: ({ search }) => ({ filters: pageListFilters(search) }),
  loader: async ({ context, deps }) => {
    const pages = await context.queryClient.ensureInfiniteQueryData(
      pagesQueryOptions(deps.filters),
    );
    const firstPage = pages.pages[0]?.items[0];
    if (firstPage) {
      throw redirect({
        to: '/pages/$id',
        params: { id: firstPage.readableId },
        search: {
          from: deps.filters.dateRange?.from,
          to: deps.filters.dateRange?.to,
          q: deps.filters.query,
          interval: deps.filters.interval,
          view: 'preview',
        },
      });
    }
  },
  component: PagesIndexRoute,
});

function PagesIndexRoute() {
  const filters = pageListFilters(Route.useSearch());
  if (filters.dateRange || filters.query || filters.interval) {
    return (
      <WorkspaceEmpty
        eyebrow="Knowledge pages"
        title="No pages match these filters"
        description="Clear or change the filters in the sidebar."
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
