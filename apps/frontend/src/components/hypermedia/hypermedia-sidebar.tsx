import { Link } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
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
  dateRange,
  selectedResources,
  onQueryApply,
  onDateRangeApply,
  onClearSelectedResources,
}: {
  profile: KnowledgeProfile;
  query: string;
  dateRange?: CalendarDateRange;
  selectedResources: HypermediaResourceReference[];
  onQueryApply: (query: string) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
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
            query={query}
            dateRange={dateRange}
            selectedResources={selectedResources}
            onQueryApply={onQueryApply}
            onDateRangeApply={onDateRangeApply}
            onClearSelectedResources={onClearSelectedResources}
          />
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
