import { createFileRoute, redirect } from '@tanstack/react-router';
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
import { knowledgeMapQueryOptions } from '../queries/knowledge-map';

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
  loader: ({ context }) => context.queryClient.ensureQueryData(knowledgeMapQueryOptions),
  component: KnowledgeMapRoute,
});

function KnowledgeMapRoute() {
  const map = Route.useLoaderData();
  const { profile } = Route.useRouteContext();
  const { q = '', kind, id } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!profile) {
    return null;
  }
  const pages = filterKnowledgeMapPages({ pages: map.pages, query: q });
  const selection = kind && id ? { kind, readableId: id } : undefined;

  return (
    <KnowledgeWorkspace>
      <KnowledgeMapSidebar
        profile={profile}
        totalPages={map.totalPages}
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
            eyebrow="Knowledge map"
            title="The first cloud starts with a page"
            description="Create a page that mentions an entity or includes an asset. Its relationships will become the first neighborhood on this map."
            createTo="/pages/new"
            createLabel="Create the first page"
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
              key={q}
              pages={pages}
              anchorEntity={profile.selfEntity}
              selectedKey={selection ? `${selection.kind}:${selection.readableId}` : undefined}
              onSelect={(nextSelection) => {
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    kind: nextSelection.kind,
                    id: nextSelection.readableId,
                  }),
                });
              }}
            />
            {selection && (
              <KnowledgeMapPreviewPanel
                selection={selection}
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
