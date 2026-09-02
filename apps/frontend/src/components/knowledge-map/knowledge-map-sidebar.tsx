import { Search } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { KnowledgeProfile } from '../../queries/profile';
import { KnowledgeCollectionNavigation } from '../knowledge/knowledge-collection-navigation';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { Input } from '../ui/input';

export function KnowledgeMapSidebar({
  profile,
  totalPages,
  truncated,
  query,
  onQueryChange,
}: {
  profile: KnowledgeProfile;
  totalPages: number;
  truncated: boolean;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const { collapsed } = useKnowledgeWorkspace();

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-hidden', collapsed && 'z-10 overflow-visible')}
      data-collapsed={collapsed}
    >
      <KnowledgeSidebarHeader />
      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden')}>
        <div className="flex px-4">
          <KnowledgeCollectionNavigation
            collection="map"
            ownerEntityReadableId={profile.selfEntity.readableId}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <label className="block" htmlFor="knowledge-map-search">
            <span className="font-medium text-sm">Find in map</span>
            <span className="relative mt-2 block">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="knowledge-map-search"
                className="h-10 pl-9"
                type="search"
                placeholder="Page, entity, or asset"
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
              />
            </span>
          </label>

          {truncated && (
            <p className="mt-3 rounded-xl border bg-card p-3 text-muted-foreground text-xs leading-relaxed">
              Exploring the most recent neighborhood from {totalPages} pages. Search filters this
              loaded area.
            </p>
          )}
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
