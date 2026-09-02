import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useDeferredValue, useMemo } from 'react';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import {
  KnowledgeMapCanvas,
  type KnowledgeMapSelection,
} from '../components/knowledge-map/knowledge-map-canvas';
import { filterKnowledgeMapPages } from '../components/knowledge-map/knowledge-map-layout';
import { KnowledgeMapPreviewPanel } from '../components/knowledge-map/knowledge-map-preview-panel';
import { KnowledgeMapSidebar } from '../components/knowledge-map/knowledge-map-sidebar';
import { knowledgeMapFrom, knowledgeMapQueryOptions } from '../queries/knowledge-map';

const MAX_MAP_SEARCH_LENGTH = 160;
const MAX_MAP_READABLE_ID_LENGTH = 240;
type KnowledgeMapSearch = { q?: string; kind?: KnowledgeMapSelection['kind']; id?: string };

function mapSearch(search: Record<string, unknown>): KnowledgeMapSearch {
  const result: KnowledgeMapSearch = {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.slice(0, MAX_MAP_SEARCH_LENGTH);
  }
  if (
    (search.kind === 'page' || search.kind === 'entity' || search.kind === 'asset') &&
    typeof search.id === 'string' &&
    search.id.trim()
  ) {
    result.kind = search.kind;
    result.id = search.id.slice(0, MAX_MAP_READABLE_ID_LENGTH);
  }
  return result;
}

export const Route = createFileRoute('/map')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  validateSearch: mapSearch,
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(knowledgeMapQueryOptions),
  component: KnowledgeMapRoute,
});

function KnowledgeMapRoute() {
  const mapQuery = useSuspenseInfiniteQuery(knowledgeMapQueryOptions);
  const map = useMemo(() => knowledgeMapFrom(mapQuery.data.pages), [mapQuery.data.pages]);
  const { profile } = Route.useRouteContext();
  const { q = '', kind, id } = Route.useSearch();
  const navigate = Route.useNavigate();
  const deferredQuery = useDeferredValue(q);
  const pages = useMemo(
    () => filterKnowledgeMapPages({ pages: map.pages, query: deferredQuery }),
    [deferredQuery, map.pages],
  );
  if (!profile) {
    return null;
  }
  const selection = kind && id ? { kind, readableId: id } : undefined;
  function selectKnowledge(nextSelection: KnowledgeMapSelection) {
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
      <KnowledgeMapSidebar
        profile={profile}
        truncated={map.truncated}
        query={q}
        onQueryChange={(query) => {
          void navigate({
            search: (previous) => ({
              ...previous,
              q: query.trim() ? query : undefined,
            }),
            replace: true,
          });
        }}
      />
      <KnowledgeWorkspaceDetail>
        {map.pages.length === 0 ? (
          <WorkspaceEmpty
            eyebrow="Hypermedia map"
            title="Your map starts with a knowledge page"
            description="Create a knowledge page that mentions an entity or includes an asset. Its relationships will become the first neighborhood on this map."
            createTo="/pages/new"
            createLabel="Create the first knowledge page"
          />
        ) : pages.length === 0 ? (
          <div className="mx-auto flex min-h-[32rem] max-w-md flex-col justify-center px-6 text-center">
            <h2 className="font-semibold text-2xl tracking-tight">Nothing in this neighborhood</h2>
            <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
              Try a page title, entity name, description, or asset name.
            </p>
          </div>
        ) : (
          <div className="relative size-full">
            <KnowledgeMapCanvas
              key={deferredQuery}
              pages={pages}
              anchorEntity={profile.selfEntity}
              selectedKey={selection ? `${selection.kind}:${selection.readableId}` : undefined}
              onSelect={selectKnowledge}
              hasNextPage={mapQuery.hasNextPage && !deferredQuery}
              remainingPageCount={Math.max(0, map.totalPages - map.pages.length)}
              isFetchingNextPage={mapQuery.isFetchingNextPage}
              loadMoreError={mapQuery.isFetchNextPageError ? mapQuery.error : null}
              onLoadMore={() => void mapQuery.fetchNextPage()}
            />
            {selection && (
              <KnowledgeMapPreviewPanel
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
        )}
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
