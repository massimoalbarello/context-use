import { Link } from '@tanstack/react-router';
import { Library } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { buttonVariants } from '../ui/button';
import { KnowledgeMapFilters } from './knowledge-map-filters';

export function KnowledgeMapSidebar({
  profile,
  truncated,
  query,
  dateRange,
  onQueryApply,
  onDateRangeApply,
}: {
  profile: KnowledgeProfile;
  truncated: boolean;
  query: string;
  dateRange?: CalendarDateRange;
  onQueryApply: (query: string) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
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
          <KnowledgeMapFilters
            query={query}
            dateRange={dateRange}
            onQueryApply={onQueryApply}
            onDateRangeApply={onDateRangeApply}
          />

          {truncated && (
            <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
              This dense neighborhood was simplified to keep the map responsive.
            </p>
          )}
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
