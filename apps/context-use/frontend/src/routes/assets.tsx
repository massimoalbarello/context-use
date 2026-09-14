import { createFileRoute, redirect } from '@tanstack/react-router';
import { MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { AssetList } from '../components/assets/asset-list';
import { CollectionWorkspace } from '../components/knowledge/collection-workspace';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { useAssets } from '../lib/hooks/use-assets';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
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
  validateSearch: (search: Record<string, unknown>): AssetSearch & ResourceSearch => ({
    ...assetSearch(search),
    ...resourceSearch(search),
  }),
  loaderDeps: ({ search }) => ({ query: search.q }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(assetsQueryOptions(deps.query)),
  component: AssetsLayout,
});

function AssetFilterControl({ query }: { query: string }) {
  const navigate = Route.useNavigate();
  return (
    <KeywordFilter
      key={query}
      value={query}
      inputId="asset-keyword"
      placeholder="Search assets"
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
    <CollectionWorkspace
      collection="assets"
      title="Assets"
      search={<AssetFilterControl query={q} />}
      count={total}
      createTo="/assets/new"
      createLabel="New asset"
      profile={profile}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      loadMore={fetchNextPage}
    >
      <AssetList assets={assets} filtered={Boolean(q)} />
    </CollectionWorkspace>
  );
}
