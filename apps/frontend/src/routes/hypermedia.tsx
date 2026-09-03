import { createFileRoute, redirect } from '@tanstack/react-router';
import type { HypermediaSelection } from '../components/hypermedia/hypermedia-canvas';
import { HypermediaExplorer } from '../components/hypermedia/hypermedia-explorer';
import { HypermediaPreviewPanel } from '../components/hypermedia/hypermedia-preview-panel';
import { HypermediaSidebar } from '../components/hypermedia/hypermedia-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { type CalendarDateRange, calendarDateRangeFromSearch } from '../lib/temporal-coverage';
import {
  focusedHypermediaPagesQueryOptions,
  type HypermediaResourceReference,
  hypermediaResourceNeighborhoodQueryOptions,
} from '../queries/hypermedia';

const MAX_HYPERMEDIA_SEARCH_LENGTH = 160;
const MAX_HYPERMEDIA_READABLE_ID_LENGTH = 120;
type HypermediaSearch = Partial<CalendarDateRange> & {
  q?: string;
  kind?: HypermediaSelection['kind'];
  id?: string;
};

function hypermediaSearch(search: Record<string, unknown>): HypermediaSearch {
  const result: HypermediaSearch = calendarDateRangeFromSearch(search) ?? {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_LENGTH);
  }
  if (
    (search.kind === 'page' || search.kind === 'entity' || search.kind === 'asset') &&
    typeof search.id === 'string' &&
    search.id.trim()
  ) {
    result.kind = search.kind;
    result.id = search.id.trim().slice(0, MAX_HYPERMEDIA_READABLE_ID_LENGTH);
  }
  return result;
}

export const Route = createFileRoute('/hypermedia')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: hypermediaSearch,
  loaderDeps: ({ search }) => ({
    query: search.q,
    dateRange: calendarDateRangeFromSearch(search),
    kind: search.kind,
    id: search.id,
  }),
  loader: async ({ context, deps }) => {
    if (!context.profile) {
      return;
    }
    const self: HypermediaResourceReference = {
      kind: 'entity',
      readableId: context.profile.selfEntity.readableId,
    };
    const selectedResource: HypermediaResourceReference | undefined =
      deps.id && (deps.kind === 'entity' || deps.kind === 'asset')
        ? { kind: deps.kind, readableId: deps.id }
        : undefined;
    const focus = selectedResource ? [selectedResource, self] : [self];
    await Promise.all([
      context.queryClient.ensureQueryData(
        hypermediaResourceNeighborhoodQueryOptions({ anchor: self }),
      ),
      selectedResource
        ? context.queryClient.ensureQueryData(
            hypermediaResourceNeighborhoodQueryOptions({ anchor: selectedResource }),
          )
        : undefined,
      context.queryClient.ensureQueryData(
        focusedHypermediaPagesQueryOptions({
          focus,
          limit: 8,
          query: deps.query,
          dateRange: deps.dateRange,
          retainPageReadableId: deps.kind === 'page' ? deps.id : undefined,
        }),
      ),
    ]);
  },
  component: HypermediaRoute,
});

function HypermediaRoute() {
  const { profile } = Route.useRouteContext();
  const search = Route.useSearch();
  const { q = '', kind, id } = search;
  const dateRange = calendarDateRangeFromSearch(search);
  const navigate = Route.useNavigate();
  if (!profile) {
    return null;
  }
  const selection: HypermediaSelection | undefined =
    kind && id ? { kind, readableId: id } : undefined;
  function selectKnowledge(nextSelection: HypermediaSelection) {
    void navigate({
      search: (previous) => ({
        ...previous,
        kind: nextSelection.kind,
        id: nextSelection.readableId,
      }),
    });
  }

  return (
    <KnowledgeWorkspace>
      <HypermediaSidebar
        profile={profile}
        query={q}
        dateRange={dateRange}
        onQueryApply={(query) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              q: query.trim() ? query : undefined,
              kind: undefined,
              id: undefined,
            }),
            replace: true,
          });
        }}
        onDateRangeApply={(nextRange) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              from: nextRange?.from,
              to: nextRange?.to,
              kind: undefined,
              id: undefined,
            }),
            replace: true,
          });
        }}
      />
      <KnowledgeWorkspaceDetail>
        <div className="relative size-full">
          <HypermediaExplorer
            selfReadableId={profile.selfEntity.readableId}
            selection={selection}
            query={q}
            dateRange={dateRange}
            onSelect={selectKnowledge}
          />
          {selection && (
            <HypermediaPreviewPanel
              selection={selection}
              onSelect={selectKnowledge}
              onClose={() => {
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    kind: undefined,
                    id: undefined,
                  }),
                });
              }}
            />
          )}
        </div>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
