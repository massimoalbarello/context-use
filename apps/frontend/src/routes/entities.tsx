import {
  ENTITY_TYPE_FILTER_LABELS,
  ENTITY_TYPE_FILTERS,
  type EntityTypeFilter,
  MAX_ENTITY_NAME_LENGTH,
} from '@repo/backend/entity';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { EntityList } from '../components/entities/entity-list';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { KnowledgeFilterPopover } from '../components/knowledge/knowledge-filter-popover';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { type EntitySearch, entitySearch } from '../lib/entity-filters';
import { useEntities } from '../lib/hooks/use-entities';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: entitySearch,
  loaderDeps: ({ search }) => ({ query: search.q, entityType: search.entityType }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions(deps)),
  component: EntitiesLayout,
});

function EntityFilterControl({ search }: { search: EntitySearch }) {
  const navigate = Route.useNavigate();
  const onChange = (next: EntitySearch) => {
    void navigate({ to: '/entities', search: next, replace: true });
  };
  const type = search.entityType ?? 'all';
  return (
    <KnowledgeFilterPopover
      title="Filter entities"
      filtered={Boolean(search.q || search.entityType)}
    >
      <KeywordFilter
        key={search.q ?? ''}
        value={search.q ?? ''}
        inputId="entity-keyword"
        placeholder="Search entities"
        maxLength={MAX_ENTITY_NAME_LENGTH}
        autoFocus
        onApply={(query) => onChange({ ...search, q: query || undefined })}
      />
      <div className="grid gap-1.5">
        <span className="font-medium text-xs">Type</span>
        <Select<EntityTypeFilter>
          value={type}
          onValueChange={(next) =>
            onChange({ ...search, entityType: next === 'all' ? undefined : (next ?? undefined) })
          }
        >
          <SelectTrigger className="w-full" aria-label="Entity type filter">
            <SelectValue>{ENTITY_TYPE_FILTER_LABELS[type]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ENTITY_TYPE_FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {ENTITY_TYPE_FILTER_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
        Reset filters
      </Button>
    </KnowledgeFilterPopover>
  );
}

function EntitiesLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', entityType } = search;
  const { entities, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useEntities({
    query: q,
    entityType,
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
        actions={<EntityFilterControl search={search} />}
      >
        <EntityList entities={entities} filtered={Boolean(q || entityType)} search={search} />
      </KnowledgeSidebar>
      <KnowledgeWorkspaceDetail>
        <Outlet />
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
