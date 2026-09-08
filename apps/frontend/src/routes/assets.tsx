import { MAX_ASSET_NAME_LENGTH } from '@repo/backend/asset';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AssetList } from '../components/assets/asset-list';
import { CollectionKeywordFilter } from '../components/knowledge/collection-keyword-filter';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { useAssets } from '../lib/hooks/use-assets';
import { assetsQueryOptions } from '../queries/assets';

export type AssetSearch = { q?: string };

export function assetSearch(search: Record<string, unknown>): AssetSearch {
  return typeof search.q === 'string' && search.q.trim()
    ? { q: search.q.trim().slice(0, MAX_ASSET_NAME_LENGTH) }
    : {};
}

export const Route = createFileRoute('/assets')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: assetSearch,
  loaderDeps: ({ search }) => ({ query: search.q }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(assetsQueryOptions(deps.query)),
  component: AssetsLayout,
});

function AssetFilterControl({ query }: { query: string }) {
  const navigate = Route.useNavigate();
  return (
    <CollectionKeywordFilter
      title="Filter assets"
      query={query}
      inputId="asset-keyword"
      placeholder="Asset name"
      maxLength={MAX_ASSET_NAME_LENGTH}
      onApply={(nextQuery) => {
        void navigate({
          to: '/assets',
          search: { q: nextQuery || undefined },
          replace: true,
        });
      }}
    />
  );
}

function AssetsLayout() {
  const { profile } = Route.useRouteContext();
  const { q = '' } = Route.useSearch();
  const { assets, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useAssets(q);
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
        actions={<AssetFilterControl query={q} />}
      >
        <AssetList assets={assets} filtered={Boolean(q)} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
