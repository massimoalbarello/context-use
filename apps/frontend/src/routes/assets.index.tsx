import { createFileRoute, redirect } from '@tanstack/react-router';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { assetsQueryOptions } from '../queries/assets';

export const Route = createFileRoute('/assets/')({
  loader: async ({ context }) => {
    const assets = await context.queryClient.ensureInfiniteQueryData(assetsQueryOptions);
    const firstAsset = assets.pages[0]?.items[0];
    if (firstAsset) {
      throw redirect({ to: '/assets/$id', params: { id: firstAsset.readableId } });
    }
  },
  component: AssetsIndexRoute,
});

function AssetsIndexRoute() {
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
