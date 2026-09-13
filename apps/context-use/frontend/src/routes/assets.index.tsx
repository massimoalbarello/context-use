import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { assetsQueryOptions } from '../queries/assets';

export const Route = createFileRoute('/assets/')({
  loaderDeps: ({ search }) => ({ query: search.q }),
  loader: async ({ context, deps }) => {
    const assets = await context.queryClient.ensureInfiniteQueryData(
      assetsQueryOptions(deps.query),
    );
    const firstAsset = assets.pages[0]?.items[0];
    if (firstAsset) {
      throw redirect({
        to: '/assets/$id',
        params: { id: firstAsset.readableId },
        search: { q: deps.query },
      });
    }
  },
  component: AssetsIndexRoute,
});

function AssetsIndexRoute() {
  const { q } = Route.useSearch();
  if (q) {
    return (
      <WorkspaceEmpty
        eyebrow="Evidence"
        title="No assets match this search"
        description="Clear or change the keyword search in the sidebar."
        createTo="/assets/new"
        createLabel="Upload an asset"
      />
    );
  }
  return (
    <WorkspaceEmpty
      eyebrow="Evidence"
      title="No assets yet"
      description="Upload a file, then embed it in or attach it to a knowledge page."
      createTo="/assets/new"
      createLabel="Upload the first asset"
    />
  );
}
