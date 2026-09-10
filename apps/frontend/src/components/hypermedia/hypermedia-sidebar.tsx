import { Link } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { cn } from '../../lib/class-names';
import type { HypermediaResourceReference, HypermediaView } from '../../queries/hypermedia';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { buttonVariants } from '../ui/button';
import { HypermediaFilters } from './hypermedia-filters';
import type { HypermediaResourceKind } from './hypermedia-resource-filter';

export function HypermediaSidebar({
  profile,
  view,
  month,
  resourceKinds,
  query,
  selectedResources,
  onViewChange,
  onResourceKindToggle,
  onQueryApply,
  onClearSelectedResources,
}: {
  profile: KnowledgeProfile;
  view: HypermediaView;
  month?: CalendarMonth;
  resourceKinds: HypermediaResourceKind[];
  query: string;
  selectedResources: HypermediaResourceReference[];
  onViewChange: (view: HypermediaView) => void;
  onResourceKindToggle: (kind: HypermediaResourceKind) => void;
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <HypermediaFilters
            view={view}
            month={month}
            resourceKinds={resourceKinds}
            query={query}
            selectedResources={selectedResources}
            onViewChange={onViewChange}
            onResourceKindToggle={onResourceKindToggle}
            onQueryApply={onQueryApply}
            onClearSelectedResources={onClearSelectedResources}
          />
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
