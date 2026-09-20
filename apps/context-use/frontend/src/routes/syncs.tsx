import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { KnowledgeSidebar } from '../components/knowledge/knowledge-sidebar';
import { KnowledgeWorkspace } from '../components/knowledge/knowledge-workspace';
import { KnowledgeWorkspaceDetail } from '../components/knowledge/knowledge-workspace-detail';

export const Route = createFileRoute('/syncs')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: SyncsLayout,
});
function SyncsLayout() {
  const { profile } = Route.useRouteContext();
  if (!profile) {
    return null;
  }
  return (
    <KnowledgeWorkspace>
      <KnowledgeSidebar profile={profile} />
      <KnowledgeWorkspaceDetail>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-8 pt-20 md:px-10 md:py-12 md:pt-20">
          <div className="mx-auto w-full max-w-4xl">
            <Outlet />
          </div>
        </main>
      </KnowledgeWorkspaceDetail>
    </KnowledgeWorkspace>
  );
}
