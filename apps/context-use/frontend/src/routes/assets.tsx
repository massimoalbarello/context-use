import { createFileRoute, redirect } from '@tanstack/react-router';
import { MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import { AssetList } from '../components/assets/asset-list';
import { CollectionWorkspace } from '../components/knowledge/collection-workspace';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { PublicationVisibilityFilter } from '../components/publications/publication-visibility-filter';
import { useAssets } from '../lib/hooks/use-assets';
import { publicationVisibilityFromSearch } from '../lib/publication-visibility';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { assetsQueryOptions } from '../queries/assets';

export type AssetSearch = { q?: string; visibility?: PublicationVisibility };

export function assetSearch(search: Record<string, unknown>): AssetSearch {
  return {
    q:
      typeof search.q === 'string'
        ? search.q.trim().slice(0, MAX_ASSET_NAME_LENGTH) || undefined
        : undefined,
    visibility: publicationVisibilityFromSearch(search.visibility),
  };
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
  loaderDeps: ({ search }) => ({ query: search.q, visibility: search.visibility }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(assetsQueryOptions(deps)),
  component: AssetsLayout,
});

function AssetFilterControl({ query }: { query: string }) {
  const navigate = Route.useNavigate();
  return (
    <KeywordFilter
      value={query}
      inputId="asset-keyword"
      placeholder="Search assets"
      maxLength={MAX_ASSET_NAME_LENGTH}
      onApply={(nextQuery) => {
        void navigate({
          to: '/assets',
          search: (previous) => ({ ...previous, q: nextQuery || undefined }),
          replace: true,
        });
      }}
    />
  );
}

function AssetsLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', visibility } = search;
  const navigate = Route.useNavigate();
  const { assets, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useAssets({
    query: q,
    visibility,
  });
  if (!profile) {
    return null;
  }
  return (
    <CollectionWorkspace
      collection="assets"
      title="Assets"
      search={<AssetFilterControl query={q} />}
      visibleFilters={
        <PublicationVisibilityFilter
          value={search.visibility}
          onChange={(visibility) => {
            void navigate({
              to: '/assets',
              search: (previous) => ({ ...previous, visibility }),
              replace: true,
            });
          }}
        />
      }
      count={total}
      createTo="/assets/new"
      createLabel="New asset"
      profile={profile}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      loadMore={fetchNextPage}
    >
      <AssetList assets={assets} filtered={Boolean(q || visibility)} />
    </CollectionWorkspace>
  );
}
