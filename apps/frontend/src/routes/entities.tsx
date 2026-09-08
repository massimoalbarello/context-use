import { MAX_ENTITY_NAME_LENGTH } from '@repo/backend/entity';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { EntityList } from '../components/entities/entity-list';
import { CollectionKeywordFilter } from '../components/knowledge/collection-keyword-filter';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

export type EntitySearch = { q?: string };

export function entitySearch(search: Record<string, unknown>): EntitySearch {
  return typeof search.q === 'string' && search.q.trim()
    ? { q: search.q.trim().slice(0, MAX_ENTITY_NAME_LENGTH) }
    : {};
}

export const Route = createFileRoute('/entities')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: entitySearch,
  loaderDeps: ({ search }) => ({ query: search.q }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions(deps.query)),
  component: EntitiesLayout,
});

function EntityFilterControl({ query }: { query: string }) {
  const navigate = Route.useNavigate();
  return (
    <CollectionKeywordFilter
      title="Filter entities"
      query={query}
      inputId="entity-keyword"
      placeholder="Entity name"
      maxLength={MAX_ENTITY_NAME_LENGTH}
      onApply={(nextQuery) => {
        void navigate({
          to: '/entities',
          search: { q: nextQuery || undefined },
          replace: true,
        });
      }}
    />
  );
}

function EntitiesLayout() {
  const { profile } = Route.useRouteContext();
  const { q = '' } = Route.useSearch();
  const { entities, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useEntities({
    query: q,
  });
  if (!profile) {
    return <Outlet />;
  }

  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar
        collection="entities"
        count={total}
        createTo="/entities/new"
        createLabel="New entity"
        profile={profile}
        error={error}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMore={fetchNextPage}
        actions={<EntityFilterControl query={q} />}
      >
        <EntityList entities={entities} filtered={Boolean(q)} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
