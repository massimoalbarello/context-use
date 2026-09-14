import { buttonVariants } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { Link } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';

export function HypermediaSidebar({ profile }: { profile: KnowledgeProfile }) {
  const { collapsed } = useKnowledgeWorkspace();

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-10 overflow-visible')}
      data-collapsed={collapsed}
    >
      <KnowledgeSidebarHeader />
      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <div className="px-4">
          <Link
            className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start')}
            to="/pages"
          >
            <Library aria-hidden="true" />
            Browse resources
          </Link>
        </div>

        <div className="flex-1" />

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
