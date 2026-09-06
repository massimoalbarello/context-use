// biome-ignore-all lint/style/noMagicNumbers: Temporal canvas geometry and interaction thresholds are visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Small render and event callbacks remain clearer inline.

import { File, FileText, MoveHorizontal } from 'lucide-react';
import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import type {
  HypermediaPage,
  HypermediaPages,
  HypermediaResourceReference,
} from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';
import { Button } from '../ui/button';
import type { HypermediaSelection, SettledHypermediaViewport } from './hypermedia-canvas';
import type { HypermediaLayoutResource } from './hypermedia-layout';
import {
  buildTemporalHypermediaLayout,
  TEMPORAL_RESOURCE_LABEL_WIDTH,
  type TemporalHypermediaResource,
  temporalRangeForViewport,
  temporalScrollLeftForRange,
} from './hypermedia-temporal-layout';

const RANGE_SETTLE_MS = 280;
const RESOURCE_SETTLE_MS = 280;
const RESOURCE_DISCOVERY_DISTANCE = 360;

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function shortLabel(value: string, length = 28): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

function dateRangeLabel(range?: CalendarDateRange): string {
  if (!range) {
    return 'All time';
  }
  return `${DATE_FORMATTER.format(new Date(`${range.from}T00:00:00.000Z`))} – ${DATE_FORMATTER.format(
    new Date(`${range.to}T00:00:00.000Z`),
  )}`;
}

function resourceReference(resource: TemporalHypermediaResource): HypermediaResourceReference {
  return { kind: resource.kind, readableId: resource.readableId };
}

function ResourceIdentity({ resource }: { resource: TemporalHypermediaResource }) {
  const detail = resource.resource;
  const imageReadableId =
    detail?.kind === 'entity'
      ? detail.entity.image?.readableId
      : detail?.kind === 'asset' && isEmbeddableAsset(detail.asset)
        ? detail.asset.readableId
        : undefined;
  return (
    <>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground',
          resource.kind === 'entity' ? 'rounded-full' : 'rounded-lg',
        )}
      >
        {imageReadableId ? (
          <img className="size-full object-cover" src={assetContentUrl(imageReadableId)} alt="" />
        ) : resource.kind === 'entity' ? (
          <span className="font-semibold">{resource.label.trim().charAt(0) || '?'}</span>
        ) : (
          <File className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate font-medium text-sm">{resource.label}</span>
        <span className="block text-muted-foreground text-xs">
          {resource.kind === 'entity' ? 'Entity' : 'Asset'}
        </span>
      </span>
    </>
  );
}

function TemporalResourceLabels({
  resources,
  activeKey,
  selectedResourceKeys,
  trackRef,
  onSelect,
}: {
  resources: TemporalHypermediaResource[];
  activeKey?: string;
  selectedResourceKeys: Set<string>;
  trackRef: { current: HTMLDivElement | null };
  onSelect: (selection: HypermediaSelection) => void;
}) {
  return (
    <div ref={trackRef} className="absolute inset-x-0 top-0 will-change-transform">
      {resources.map((resource) => {
        const active = activeKey === resource.key || selectedResourceKeys.has(resource.key);
        return (
          <Button
            key={resource.key}
            type="button"
            variant="ghost"
            className={cn(
              'absolute left-2 h-14 w-[calc(100%-1rem)] justify-start gap-2 rounded-xl px-2',
              active && 'border bg-accent shadow-sm',
            )}
            style={{ top: resource.y - 28 }}
            aria-pressed={selectedResourceKeys.has(resource.key)}
            onClick={() => onSelect({ kind: resource.kind, readableId: resource.readableId })}
          >
            <ResourceIdentity resource={resource} />
          </Button>
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
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  extent: HypermediaPages['temporalExtent'];
  dateRange?: CalendarDateRange;
  selectedResources: HypermediaResourceReference[];
  selectedKey?: string;
  onSelect: (selection: HypermediaSelection) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  onViewportSettled: (viewport: SettledHypermediaViewport) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const labelTrackRef = useRef<HTMLDivElement | null>(null);
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollLeft = useRef<number | null>(null);
  const initializedView = useRef<string | null>(null);
  const [visibleRange, setVisibleRange] = useState<CalendarDateRange | undefined>(dateRange);
  const layout = useMemo(
    () => (extent ? buildTemporalHypermediaLayout({ resources, pages, extent }) : null),
    [extent, pages, resources],
  );
  const selectedResourceKeys = useMemo(
    () => new Set(selectedResources.map(hypermediaResourceKey)),
    [selectedResources],
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
    setVisibleRange(
      temporalRangeForViewport({
        layout,
        scrollLeft,
        viewportWidth: scroller.clientWidth,
      }),
    );
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
    if (labelTrackRef.current) {
      labelTrackRef.current.style.transform = `translateY(${-scroller.scrollTop}px)`;
    }
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
    setVisibleRange(nextRange);
    if (rangeTimer.current) {
      clearTimeout(rangeTimer.current);
    }
    rangeTimer.current = setTimeout(() => onDateRangeApply(nextRange), RANGE_SETTLE_MS);
  }

  function scrollLabels(event: WheelEvent<HTMLDivElement>) {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop += event.deltaY;
    }
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
      className="relative grid size-full min-h-[28rem] grid-cols-[13.5rem_minmax(0,1fr)] overflow-hidden bg-card"
      aria-label={`Temporal Hypermedia with ${layout.pages.length} knowledge pages and ${layout.resources.length} entities and assets`}
    >
      <div
        className="relative z-20 overflow-hidden border-r bg-card"
        style={{ width: TEMPORAL_RESOURCE_LABEL_WIDTH }}
        onWheel={scrollLabels}
      >
        <div className="absolute inset-x-0 top-0 z-10 flex h-16 items-end bg-card px-4 pb-2 font-medium text-muted-foreground text-xs">
          Entities and assets
        </div>
        <TemporalResourceLabels
          resources={layout.resources}
          activeKey={selectedKey}
          selectedResourceKeys={selectedResourceKeys}
          trackRef={labelTrackRef}
          onSelect={onSelect}
        />
      </div>

      <div ref={scrollerRef} className="relative overflow-auto" onScroll={handleScroll}>
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
              const key = `page:${item.page.readableId}`;
              const active = selectedKey === key;
              return (
                <a
                  key={item.page.readableId}
                  href={`/pages/${encodeURIComponent(item.page.readableId)}?view=preview`}
                  aria-label={`Open temporal knowledge page ${item.page.title}`}
                  className="cursor-pointer outline-none"
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect({ kind: 'page', readableId: item.page.readableId });
                  }}
                >
                  <title>{item.page.title}</title>
                  <path
                    d={item.path}
                    style={{
                      color: `var(--chart-${item.colorIndex})`,
                      fill: 'currentColor',
                      fillOpacity: active ? 0.25 : 0.12,
                      stroke: 'currentColor',
                      strokeOpacity: active ? 0.95 : 0.62,
                      strokeWidth: active ? 3 : 1.5,
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                  {item.resourceKeys.flatMap((resourceKey) => {
                    const row = layout.resources.find(
                      ({ key: candidate }) => candidate === resourceKey,
                    );
                    return row
                      ? [
                          <circle
                            key={resourceKey}
                            cx={item.label.x}
                            cy={row.y}
                            r={active ? 5 : 3.5}
                            style={{ color: `var(--chart-${item.colorIndex})` }}
                            className="fill-current"
                          />,
                        ]
                      : [];
                  })}
                  <text
                    x={item.label.x}
                    y={item.label.y + 4}
                    textAnchor="middle"
                    className={cn(
                      'fill-foreground stroke-[7] stroke-card font-semibold text-[13px] [paint-order:stroke] [stroke-linejoin:round]',
                      active && 'underline decoration-2 underline-offset-4',
                    )}
                  >
                    {shortLabel(item.page.title)}
                  </text>
                </a>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="pointer-events-none absolute top-3 right-4 z-30 flex items-center gap-2 rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur">
        <MoveHorizontal className="size-3.5" aria-hidden="true" />
        <span>Scroll through time</span>
        <span aria-hidden="true">·</span>
        <output className="font-medium text-foreground tabular-nums">
          {dateRangeLabel(visibleRange)}
        </output>
      </div>
    </section>
  );
}
