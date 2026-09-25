import { Button } from '@repo/ui/button';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import {
  ENTITY_TYPE_FILTER_LABELS,
  ENTITY_TYPE_FILTERS,
  type EntityTypeFilter,
  MAX_ENTITY_NAME_LENGTH,
} from '#backend/models/entities/model.ts';
import { EntityList } from '../components/entities/entity-list';
import { CollectionWorkspace } from '../components/knowledge/collection-workspace';
import { KeywordFilter } from '../components/knowledge/keyword-filter';
import { KnowledgeFilterPopover } from '../components/knowledge/knowledge-filter-popover';
import { PublicationVisibilityFilter } from '../components/publications/publication-visibility-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { type EntitySearch, entitySearch } from '../lib/entity-filters';
import { useEntities } from '../lib/hooks/use-entities';
import { type ResourceSearch, resourceSearch } from '../lib/resource-selection';
import { entitiesQueryOptions } from '../queries/entities';

export const Route = createFileRoute('/entities')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: (search: Record<string, unknown>): EntitySearch & ResourceSearch => ({
    ...entitySearch(search),
    ...resourceSearch(search),
  }),
  loaderDeps: ({ search }) => ({
    query: search.q,
    entityType: search.entityType,
    visibility: search.visibility,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(entitiesQueryOptions(deps)),
  component: EntitiesLayout,
});

function EntityFilterControl({ search }: { search: EntitySearch }) {
  const navigate = Route.useNavigate();
  const onChange = (next: EntitySearch) => {
    void navigate({
      to: '/entities',
      search: (previous) => ({ ...next, ...resourceSearch(previous) }),
      replace: true,
    });
  };
  const type = search.entityType ?? 'all';
  return (
    <KnowledgeFilterPopover
      title="Filter entities"
      filtered={Boolean(search.entityType || search.visibility)}
    >
      <PublicationVisibilityFilter
        value={search.visibility}
        onChange={(visibility) => onChange({ ...search, visibility })}
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
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ q: search.q })}>
        Reset filters
      </Button>
    </KnowledgeFilterPopover>
  );
}

function EntitiesLayout() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { q = '', entityType, visibility } = search;
  const { entities, total, error, hasNextPage, isFetchingNextPage, fetchNextPage } = useEntities({
    query: q,
    entityType,
    visibility,
  });
  if (!profile) {
    return <Outlet />;
  }

  return (
    <CollectionWorkspace
      collection="entities"
      title="Entities"
      search={
        <KeywordFilter
          inputId="entity-keyword"
          value={q}
          placeholder="Search entities"
          maxLength={MAX_ENTITY_NAME_LENGTH}
          onApply={(query) => {
            void navigate({
              to: '/entities',
              search: { ...search, q: query || undefined },
              replace: true,
            });
          }}
        />
      }
      count={total}
      createTo="/entities/new"
      createLabel="New entity"
      profile={profile}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      loadMore={fetchNextPage}
      filters={<EntityFilterControl search={search} />}
    >
      <EntityList
        entities={entities}
        filtered={Boolean(q || entityType || visibility)}
        search={search}
      />
    </CollectionWorkspace>
  );
}
