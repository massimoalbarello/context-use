import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { ArrowLeft, Bot } from 'lucide-react';
import { WorkspaceSplitLayout } from '../components/layout/workspace-split-layout';
import { buttonVariants } from '../components/ui/button';
import { cn } from '../lib/class-names';
import { MAIN_KNOWLEDGE_PATH } from '../lib/knowledge-navigation';

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <WorkspaceSplitLayout className="grid-rows-[auto_minmax(0,1fr)]">
      <aside className="grid content-start gap-6 px-4 py-5 md:px-5 md:py-7">
        <div className="grid gap-5">
          <Link
            className={cn(buttonVariants({ variant: 'ghost' }), 'w-fit justify-start')}
            to={MAIN_KNOWLEDGE_PATH}
          >
            <ArrowLeft aria-hidden="true" />
            Back to Hypermedia
          </Link>
          <strong className="px-2 font-semibold text-xl tracking-tight">Settings</strong>
        </div>
        <nav aria-label="Settings" className="grid gap-1">
          <Link
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'w-full justify-start text-muted-foreground',
            )}
            activeProps={{ className: 'bg-muted text-foreground' }}
            activeOptions={{ exact: true }}
            to="/settings"
          >
            <Bot aria-hidden="true" />
            MCP
          </Link>
        </nav>
      </aside>
      <section className="min-h-0 min-w-0 overflow-hidden p-2 md:p-3">
        <div className="h-full min-h-0 overflow-y-auto rounded-2xl bg-card">
          <Outlet />
        </div>
      </section>
    </WorkspaceSplitLayout>
  );
}
