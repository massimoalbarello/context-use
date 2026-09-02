import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/')({
  loaderDeps: ({ search }) => ({ time: search.time }),
  loader: async ({ context, deps }) => {
    const pages = await context.queryClient.ensureInfiniteQueryData(pagesQueryOptions(deps.time));
    const firstPage = pages.pages[0]?.items[0];
    if (firstPage) {
      throw redirect({
        to: '/pages/$id',
        params: { id: firstPage.readableId },
        search: { time: deps.time, view: 'preview' },
      });
    }
  },
  component: PagesIndexRoute,
});

function PagesIndexRoute() {
  const { time } = Route.useSearch();
  if (time) {
    return (
      <WorkspaceEmpty
        eyebrow="Timeline"
        title={`No pages overlap ${time}`}
        description="Clear the subject-time filter in the sidebar or create a page with matching coverage."
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
