import { Link } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { HypermediaResourceReference } from '../../queries/hypermedia';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { buttonVariants } from '../ui/button';
import { HypermediaFilters } from './hypermedia-filters';

export function HypermediaSidebar({
  profile,
  query,
  selectedResources,
  onQueryApply,
  onClearSelectedResources,
}: {
  profile: KnowledgeProfile;
  query: string;
  selectedResources: HypermediaResourceReference[];
  onQueryApply: (query: string) => void;
  onClearSelectedResources: () => void;
}) {
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 py-6">
          <HypermediaFilters
            query={query}
            selectedResources={selectedResources}
            onQueryApply={onQueryApply}
            onClearSelectedResources={onClearSelectedResources}
          />
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
