import { cn } from '@repo/ui/class-names';
import { Link } from '@tanstack/react-router';
import { FileInput, FileText, Image, Map as MapIcon, RefreshCw, Users } from 'lucide-react';
import { Fragment } from 'react';
import { isNarrowWorkspace } from '../../lib/hooks/use-narrow-workspace';
import type { KnowledgeProfile } from '../../queries/profile';
import { KnowledgeSidebarFooter, KnowledgeSidebarHeader } from './knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from './knowledge-workspace';

const destinations = [
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/syncs', label: 'Syncs', icon: RefreshCw },
  { to: '/entities', label: 'Entities', icon: Users },
  { to: '/pages', label: 'Pages', icon: FileText },
  { to: '/assets', label: 'Assets', icon: Image },
  { to: '/records', label: 'Records', icon: FileInput },
] as const;

export function KnowledgeSidebar({ profile }: { profile: KnowledgeProfile }) {
  const { collapsed, toggleSidebar } = useKnowledgeWorkspace();
  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-40 overflow-visible')}
      data-collapsed={collapsed}
    >
      <KnowledgeSidebarHeader />
      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <nav aria-label="Workspace" className="grid gap-1 px-3 py-2">
          {destinations.map(({ to, label, icon: Icon }) => (
            <Fragment key={to}>
              <Link
                to={to}
                search={{}}
                className="flex items-center gap-3 rounded-xl px-3 py-3 font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[status=active]:bg-card data-[status=active]:text-foreground data-[status=active]:shadow-sm"
                activeProps={{
                  'aria-current': 'page',
                }}
                activeOptions={{ includeSearch: false }}
                onClick={() => {
                  if (isNarrowWorkspace()) {
                    toggleSidebar();
                  }
                }}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
              {to === '/syncs' && <hr className="mx-3 my-2 border-border" />}
            </Fragment>
          ))}
        </nav>
        <div className="flex-1" />
        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
