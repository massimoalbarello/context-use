import { Link } from '@tanstack/react-router';
import { Library, X } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { HypermediaEntityReference } from '../../queries/hypermedia';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { Button, buttonVariants } from '../ui/button';

export function HypermediaSidebar({
  profile,
  selectedEntities,
  onClearSelectedEntities,
}: {
  profile: KnowledgeProfile;
  selectedEntities: HypermediaEntityReference[];
  onClearSelectedEntities: () => void;
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
          {selectedEntities.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-muted/55 p-3" aria-live="polite">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">
                  {selectedEntities.length} {selectedEntities.length === 1 ? 'entity' : 'entities'}{' '}
                  selected
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs">
                  Pages include every selection.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-full"
                aria-label="Clear selected entities"
                onClick={onClearSelectedEntities}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
