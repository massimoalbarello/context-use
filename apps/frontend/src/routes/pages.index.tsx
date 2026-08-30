import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { pagesQueryOptions } from '../queries/pages';

export const Route = createFileRoute('/pages/')({
  loader: async ({ context }) => {
    const pages = await context.queryClient.ensureInfiniteQueryData(pagesQueryOptions);
    const firstPage = pages.pages[0]?.items[0];
    if (firstPage) {
      throw redirect({
        to: '/pages/$id',
        params: { id: firstPage.readableId },
        search: { view: 'preview' },
      });
    }
  },
  component: PagesIndexRoute,
});

function PagesIndexRoute() {
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
