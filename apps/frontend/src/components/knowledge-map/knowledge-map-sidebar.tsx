import { Link } from '@tanstack/react-router';
import { ArrowLeft, CircleUserRound, FileImage, FileText, Search } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { KnowledgeProfile } from '../../queries/profile';
import {
  KnowledgeSidebarFooter,
  KnowledgeSidebarHeader,
} from '../knowledge/knowledge-sidebar-chrome';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { Badge } from '../ui/badge';
import { buttonVariants } from '../ui/button';
import { Input } from '../ui/input';

export function KnowledgeMapSidebar({
  profile,
  pageCount,
  resourceCount,
  totalPages,
  truncated,
  query,
  onQueryChange,
}: {
  profile: KnowledgeProfile;
  pageCount: number;
  resourceCount: number;
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
        <div className="px-4">
          <Link
            className={cn(buttonVariants({ variant: 'ghost' }), '-ml-2 justify-start')}
            to="/pages"
          >
            <ArrowLeft aria-hidden="true" />
            Browse knowledge
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <Badge variant="secondary">Experimental</Badge>
          <h1 className="mt-3 font-semibold text-2xl tracking-tight">Knowledge map</h1>
          <p className="mt-2 text-muted-foreground text-sm leading-relaxed">
            Pages form clouds around the entities and assets they connect. Shared dots make the
            clouds overlap; dashed arrows show page references.
          </p>

          <label className="mt-6 block" htmlFor="knowledge-map-search">
            <span className="font-medium text-xs">Find in this map</span>
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

          <div className="mt-6 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-card p-3">
              <strong className="block font-semibold text-xl">{pageCount}</strong>
              <span className="text-muted-foreground text-xs">page clouds</span>
            </div>
            <div className="rounded-xl bg-card p-3">
              <strong className="block font-semibold text-xl">{resourceCount}</strong>
              <span className="text-muted-foreground text-xs">connected dots</span>
            </div>
          </div>

          {truncated && (
            <p className="mt-3 rounded-xl border bg-card p-3 text-muted-foreground text-xs leading-relaxed">
              Showing a bounded view of the {totalPages} most recent page clouds. Search filters the
              loaded neighborhood.
            </p>
          )}

          <section className="mt-7" aria-labelledby="knowledge-map-legend">
            <h2 id="knowledge-map-legend" className="font-semibold text-xs uppercase tracking-wide">
              Legend
            </h2>
            <ul className="mt-3 grid gap-3 text-sm">
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full border bg-card">
                  <CircleUserRound className="size-4" aria-hidden="true" />
                </span>
                Entity dot
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full border bg-card">
                  <FileImage className="size-4" aria-hidden="true" />
                </span>
                Asset dot
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-8 w-11 items-center justify-center rounded-[45%] border border-chart-2/50 bg-chart-2/15">
                  <FileText className="size-4" aria-hidden="true" />
                </span>
                Page cloud
              </li>
            </ul>
          </section>

          <p className="mt-7 text-muted-foreground text-xs leading-relaxed">
            Hover or focus any dot or cloud for a preview. Click it to open the resource. Drag the
            background to explore.
          </p>
        </div>

        <KnowledgeSidebarFooter profile={profile} />
      </div>
    </aside>
  );
}
