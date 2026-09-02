import { createFileRoute, redirect } from '@tanstack/react-router';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';
import { WorkspaceEmpty } from '../components/knowledge/workspace-empty';
import { KnowledgeMapCanvas } from '../components/knowledge-map/knowledge-map-canvas';
import {
  buildKnowledgeMapLayout,
  filterKnowledgeMapPages,
} from '../components/knowledge-map/knowledge-map-layout';
import { KnowledgeMapSidebar } from '../components/knowledge-map/knowledge-map-sidebar';
import { knowledgeMapQueryOptions } from '../queries/knowledge-map';

const MAX_MAP_SEARCH_LENGTH = 160;

function mapSearch(search: Record<string, unknown>): { q?: string } {
  return typeof search.q === 'string' && search.q.trim()
    ? { q: search.q.slice(0, MAX_MAP_SEARCH_LENGTH) }
    : {};
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
  const { q = '' } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!profile) {
    return null;
  }
  const pages = filterKnowledgeMapPages({ pages: map.pages, query: q });
  const resourceCount = buildKnowledgeMapLayout(pages).resources.length;

  return (
    <KnowledgeWorkspace>
      <KnowledgeMapSidebar
        profile={profile}
        pageCount={pages.length}
        resourceCount={resourceCount}
        totalPages={map.totalPages}
        truncated={map.truncated}
        query={q}
        onQueryChange={(query) => {
          void navigate({ search: { q: query.trim() ? query : undefined }, replace: true });
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
          <KnowledgeMapCanvas key={q} pages={pages} />
        )}
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
