import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AssetList } from '../components/assets/asset-list';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { useAssets } from '../lib/hooks/use-assets';
import { assetsQueryOptions } from '../queries/assets';

export const Route = createFileRoute('/assets')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(assetsQueryOptions),
  component: AssetsLayout,
});

function AssetsLayout() {
  const { profile } = Route.useRouteContext();
  const { assets, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useAssets();
  if (!profile) {
    return null;
  }
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar
        collection="assets"
        count={total}
        createTo="/assets/new"
        createLabel="New asset"
        profile={profile}
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
      >
        <AssetList assets={assets} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
