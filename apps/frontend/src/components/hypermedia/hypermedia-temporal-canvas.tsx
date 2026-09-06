// biome-ignore-all lint/style/noMagicNumbers: Temporal canvas geometry and interaction thresholds are visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Small render and event callbacks remain clearer inline.

import { FileText } from 'lucide-react';
import { type UIEvent, useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import type { HypermediaPages, HypermediaResourceReference } from '../../queries/hypermedia';
import { Button } from '../ui/button';
import {
  type HypermediaSelection,
  hypermediaSelectionKey,
  selectedHypermediaResourceKeys,
} from './hypermedia-selection';
import {
  buildTemporalHypermediaLayout,
  type TemporalHypermediaResource,
  temporalRangeForViewport,
  temporalScrollLeftForRange,
} from './hypermedia-temporal-layout';
import {
  HypermediaPageCloud,
  HypermediaPageLabel,
  HypermediaPageLink,
  HypermediaResourceCardContent,
  type HypermediaViewProps,
} from './hypermedia-view';

const RANGE_SETTLE_MS = 280;
const RESOURCE_SETTLE_MS = 280;
const RESOURCE_DISCOVERY_DISTANCE = 360;

function resourceReference(resource: TemporalHypermediaResource): HypermediaResourceReference {
  return { kind: resource.kind, readableId: resource.readableId };
}

function TemporalResourceWagons({
  resources,
  width,
  activeKey,
  selectedResourceKeys,
  onSelect,
}: {
  resources: TemporalHypermediaResource[];
  width: number;
  activeKey?: string;
  selectedResourceKeys: Set<string>;
  onSelect: (selection: HypermediaSelection) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {resources.map((resource) => {
        const active = activeKey === resource.key || selectedResourceKeys.has(resource.key);
        return (
          <div
            key={resource.key}
            className="pointer-events-none absolute left-0 h-14"
            style={{ top: resource.y - 60, width }}
          >
            <Button
              type="button"
              variant="outline"
              className={cn(
                'pointer-events-auto sticky left-4 h-14 w-60 justify-start gap-2 rounded-xl bg-card/95 px-3 text-left shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 motion-reduce:transform-none',
                active && 'border-foreground bg-accent shadow-md',
              )}
              aria-pressed={selectedResourceKeys.has(resource.key)}
              onClick={() => onSelect({ kind: resource.kind, readableId: resource.readableId })}
            >
              <HypermediaResourceCardContent
                resource={resource.resource}
                reference={resourceReference(resource)}
                fallbackLabel={resource.label}
              />
              <span
                className="absolute -bottom-1 left-8 size-2 rounded-full border bg-card"
                aria-hidden="true"
              />
              <span
                className="absolute right-8 -bottom-1 size-2 rounded-full border bg-card"
                aria-hidden="true"
              />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function HypermediaTemporalCanvas({
  resources,
  pages,
  extent,
  dateRange,
  selectedResources,
  selectedKey,
  onSelect,
  onDateRangeApply,
  onViewportSettled,
}: HypermediaViewProps & {
  extent: HypermediaPages['temporalExtent'];
  dateRange?: CalendarDateRange;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollLeft = useRef<number | null>(null);
  const initializedView = useRef<string | null>(null);
  const layout = useMemo(
    () => (extent ? buildTemporalHypermediaLayout({ resources, pages, extent }) : null),
    [extent, pages, resources],
  );
  const selectedResourceKeys = useMemo(
    () => selectedHypermediaResourceKeys(selectedResources),
    [selectedResources],
  );
  const resourceByKey = useMemo(
    () => new Map(layout?.resources.map((resource) => [resource.key, resource]) ?? []),
    [layout],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!layout || !scroller) {
      return;
    }
    const rangeKey = dateRange ? `${dateRange.from}:${dateRange.to}` : 'latest';
    const viewKey = `${layout.extent.start}:${layout.extent.end}:${rangeKey}`;
    if (initializedView.current === viewKey) {
      return;
    }
    initializedView.current = viewKey;
    const scrollLeft = temporalScrollLeftForRange({
      layout,
      range: dateRange,
      viewportWidth: scroller.clientWidth,
    });
    scroller.scrollLeft = scrollLeft;
    lastScrollLeft.current = scrollLeft;
  }, [dateRange, layout]);

  useEffect(
    () => () => {
      if (rangeTimer.current) {
        clearTimeout(rangeTimer.current);
      }
      if (resourceTimer.current) {
        clearTimeout(resourceTimer.current);
      }
    },
    [],
  );

  const publishVisibleResources = useCallback(
    (scroller: HTMLDivElement) => {
      if (!layout) {
        return;
      }
      const top = scroller.scrollTop;
      const bottom = top + scroller.clientHeight;
      const visible = layout.resources.filter(({ y }) => y >= top && y <= bottom);
      const detailed = visible.filter(({ resource }) => resource !== undefined);
      const focus = detailed.slice(0, 8).map(resourceReference);
      const discoverMoreEntities = scroller.scrollHeight - bottom < RESOURCE_DISCOVERY_DISTANCE;
      const boundary = detailed.at(-1);
      onViewportSettled({
        focus,
        discoverMoreEntities,
        boundaryAnchor: discoverMoreEntities && boundary ? resourceReference(boundary) : undefined,
      });
    },
    [layout, onViewportSettled],
  );

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    if (resourceTimer.current) {
      clearTimeout(resourceTimer.current);
    }
    resourceTimer.current = setTimeout(() => publishVisibleResources(scroller), RESOURCE_SETTLE_MS);
    if (!layout || lastScrollLeft.current === scroller.scrollLeft) {
      return;
    }
    lastScrollLeft.current = scroller.scrollLeft;
    const nextRange = temporalRangeForViewport({
      layout,
      scrollLeft: scroller.scrollLeft,
      viewportWidth: scroller.clientWidth,
    });
    if (rangeTimer.current) {
      clearTimeout(rangeTimer.current);
    }
    rangeTimer.current = setTimeout(() => onDateRangeApply(nextRange), RANGE_SETTLE_MS);
  }

  if (!layout) {
    return (
      <section
        className="grid size-full min-h-[28rem] place-items-center bg-card"
        aria-label="Temporal Hypermedia"
      >
        <div className="max-w-sm text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No temporal pages yet</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Add a time interval to a knowledge page to place it in this view.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative size-full min-h-[28rem] overflow-hidden bg-card"
      aria-label={`Temporal Hypermedia with ${layout.pages.length} knowledge pages and ${layout.resources.length} entities and assets`}
    >
      <div ref={scrollerRef} className="relative size-full overflow-auto" onScroll={handleScroll}>
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg
            className="absolute inset-0 size-full select-none"
            aria-label="Scrollable temporal page timeline"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
          >
            {layout.ticks.map((tick) => (
              <g key={tick.x}>
                <line
                  x1={tick.x}
                  y1={52}
                  x2={tick.x}
                  y2={layout.height}
                  className="stroke-border/60"
                  strokeDasharray="3 7"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={tick.x}
                  y={42}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {layout.resources.map((resource) => {
              const active = selectedKey === resource.key || selectedResourceKeys.has(resource.key);
              return (
                <line
                  key={resource.key}
                  x1={layout.timelineStartX}
                  y1={resource.y}
                  x2={layout.timelineEndX}
                  y2={resource.y}
                  className={cn('stroke-border', active && 'stroke-foreground')}
                  strokeWidth={active ? 3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {layout.pages.map((item) => {
              const key = hypermediaSelectionKey({
                kind: 'page',
                readableId: item.page.readableId,
              });
              const active = selectedKey === key;
              const connectedRows = item.resourceKeys.flatMap((resourceKey) => {
                const row = resourceByKey.get(resourceKey);
                return row ? [row] : [];
              });
              return (
                <HypermediaPageLink
                  key={item.page.readableId}
                  page={item.page}
                  aria-label={`Open temporal knowledge page ${item.page.title}`}
                  onSelect={onSelect}
                >
                  <title>{item.page.title}</title>
                  {connectedRows.map((row) => {
                    const cloudEdgeY =
                      row.y < item.bounds.top
                        ? item.bounds.top
                        : row.y > item.bounds.bottom
                          ? item.bounds.bottom
                          : row.y;
                    return (
                      <line
                        key={`connector:${row.key}`}
                        x1={item.label.x}
                        y1={cloudEdgeY}
                        x2={item.label.x}
                        y2={row.y}
                        style={{ color: `var(--chart-${item.colorIndex})` }}
                        className="pointer-events-none stroke-current opacity-45"
                        strokeWidth={active ? 2.5 : 1.5}
                        strokeDasharray="3 5"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                  <HypermediaPageCloud
                    path={item.path}
                    colorIndex={item.colorIndex}
                    active={active}
                  />
                  {connectedRows.map((row) => (
                    <circle
                      key={row.key}
                      cx={item.label.x}
                      cy={row.y}
                      r={active ? 5 : 3.5}
                      style={{ color: `var(--chart-${item.colorIndex})` }}
                      className="pointer-events-none fill-current"
                    />
                  ))}
                  <HypermediaPageLabel page={item.page} point={item.label} active={active} />
                </HypermediaPageLink>
              );
            })}
          </svg>
          <TemporalResourceWagons
            resources={layout.resources}
            width={layout.width}
            activeKey={selectedKey}
            selectedResourceKeys={selectedResourceKeys}
            onSelect={onSelect}
          />
        </div>
      </div>
    </section>
  );
}
