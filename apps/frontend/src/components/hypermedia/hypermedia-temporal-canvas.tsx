// biome-ignore-all lint/style/noMagicNumbers: Temporal canvas geometry and interaction thresholds are visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Small render and event callbacks remain clearer inline.

import { FileText, Layers2 } from 'lucide-react';
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import type { HypermediaPages, HypermediaResourceReference } from '../../queries/hypermedia';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import {
  buildTemporalHypermediaLayout,
  type TemporalHypermediaResource,
  temporalRangeForViewport,
  temporalScrollTopForRange,
} from './hypermedia-temporal-layout';
import {
  HypermediaHoverPreview,
  HypermediaPageCloud,
  HypermediaPageLabel,
  HypermediaPageLink,
  type HypermediaPreview,
  HypermediaResourceNode,
  type HypermediaViewProps,
  useHypermediaViewState,
} from './hypermedia-view';

const RANGE_SETTLE_MS = 280;
const RESOURCE_SETTLE_MS = 280;
const RESOURCE_DISCOVERY_DISTANCE = 360;
const PAGE_DISCOVERY_DISTANCE = 360;
const RESOURCE_HEADER_HEIGHT = 112;
const PAGE_FADE_DISTANCE = 96;
const OVERLAPPING_PAGES_NOTE = 'Overlapping clouds mark pages on the same or nearby dates';

type TemporalPageViewport = { scrollTop: number; height: number };

function temporalPageOpacity({
  bounds,
  viewport,
}: {
  bounds: { top: number; bottom: number };
  viewport: TemporalPageViewport | null;
}): number {
  if (!viewport) {
    return 1;
  }
  const topEdge = viewport.scrollTop + RESOURCE_HEADER_HEIGHT;
  const bottomEdge = viewport.scrollTop + viewport.height;
  const distanceFromTop = bounds.bottom - topEdge;
  const distanceFromBottom = bottomEdge - bounds.top;
  return Math.min(
    1,
    Math.max(0, Math.min(distanceFromTop, distanceFromBottom) / PAGE_FADE_DISTANCE),
  );
}

function resourceReference(resource: TemporalHypermediaResource): HypermediaResourceReference {
  return { kind: resource.kind, readableId: resource.readableId };
}

function resourcePreview(resource: TemporalHypermediaResource): HypermediaPreview | null {
  if (resource.resource?.kind === 'entity') {
    return { kind: 'entity', entity: resource.resource.entity };
  }
  if (resource.resource?.kind === 'asset') {
    return { kind: 'asset', asset: resource.resource.asset };
  }
  return null;
}

function TemporalResourceHeaders({
  resources,
  width,
  activeKey,
  selectedResourceKeys,
  onSelect,
  onPreview,
  onPreviewEnd,
}: {
  resources: TemporalHypermediaResource[];
  width: number;
  activeKey?: string;
  selectedResourceKeys: Set<string>;
  onSelect: (selection: HypermediaSelection) => void;
  onPreview: (preview: HypermediaPreview) => void;
  onPreviewEnd: (key: string) => void;
}) {
  return (
    <div className="pointer-events-none sticky top-0 z-30 h-28 border-b bg-card" style={{ width }}>
      {resources.map((resource) => {
        const active = activeKey === resource.key || selectedResourceKeys.has(resource.key);
        const preview = resourcePreview(resource);
        return (
          <div
            key={resource.key}
            className="pointer-events-none absolute top-0 -translate-x-1/2"
            style={{ left: resource.x }}
          >
            <Button
              type="button"
              variant="ghost"
              className="pointer-events-auto h-28 w-[72px] rounded-none p-0 hover:bg-transparent dark:hover:bg-transparent"
              aria-label={resource.label}
              aria-pressed={selectedResourceKeys.has(resource.key)}
              onPointerEnter={() => preview && onPreview(preview)}
              onPointerLeave={() => onPreviewEnd(resource.key)}
              onFocus={() => preview && onPreview(preview)}
              onBlur={() => onPreviewEnd(resource.key)}
              onClick={() => onSelect({ kind: resource.kind, readableId: resource.readableId })}
            >
              <svg className="size-full overflow-visible" viewBox="0 0 72 112" aria-hidden="true">
                <HypermediaResourceNode
                  point={{ x: 36, y: 31 }}
                  resource={resource.resource ?? resource}
                  active={active}
                  labelWidth={72}
                />
              </svg>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function TemporalTimeLabels({
  ticks,
  width,
}: {
  ticks: Array<{ y: number; label: string }>;
  width: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {ticks.map((tick) => (
        <div key={tick.y} className="absolute left-0 h-px" style={{ top: tick.y, width }}>
          <time className="sticky left-3 inline-block -translate-y-1/2 rounded-md bg-card/90 px-2 py-1 font-medium text-muted-foreground text-xs tabular-nums backdrop-blur">
            {tick.label}
          </time>
        </div>
      ))}
    </div>
  );
}

export function HypermediaTimelineCanvas({
  resources,
  pages,
  extent,
  dateRange,
  selectedResources,
  selectedKey,
  onSelect,
  onDateRangeApply,
  onViewportSettled,
  hasNextPage,
  isFetchingNextPage,
  onDiscoverMorePages,
}: HypermediaViewProps & {
  extent: HypermediaPages['temporalExtent'];
  dateRange?: CalendarDateRange;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onDiscoverMorePages: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTop = useRef<number | null>(null);
  const lastScrollLeft = useRef<number | null>(null);
  const initializedView = useRef<string | null>(null);
  const pageDiscoveryPending = useRef(false);
  const [pageViewport, setPageViewport] = useState<TemporalPageViewport | null>(null);
  const layout = useMemo(
    () => (extent ? buildTemporalHypermediaLayout({ resources, pages, extent }) : null),
    [extent, pages, resources],
  );
  const { activeKey, clearPreview, preview, selectedResourceKeys, setPreview } =
    useHypermediaViewState({ selectedResources, selectedKey });
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
    const scrollTop = temporalScrollTopForRange({
      layout,
      range: dateRange,
      viewportHeight: scroller.clientHeight,
    });
    scroller.scrollTop = scrollTop;
    lastScrollTop.current = scrollTop;
    lastScrollLeft.current = scroller.scrollLeft;
    setPageViewport({ scrollTop, height: scroller.clientHeight });
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
      const left = scroller.scrollLeft;
      const right = left + scroller.clientWidth;
      const visible = layout.resources.filter(({ x }) => x >= left && x <= right);
      const detailed = visible.filter(({ resource }) => resource !== undefined);
      const focus = detailed.slice(0, 8).map(resourceReference);
      const discoverMoreEntities = scroller.scrollWidth - right < RESOURCE_DISCOVERY_DISTANCE;
      const boundary = detailed.at(-1);
      onViewportSettled({
        focus,
        discoverMoreEntities,
        boundaryAnchor: discoverMoreEntities && boundary ? resourceReference(boundary) : undefined,
      });
    },
    [layout, onViewportSettled],
  );

  const discoverMorePages = useCallback(
    (scroller: HTMLDivElement) => {
      if (
        layout?.pageLoadBoundaryY === null ||
        !layout ||
        !hasNextPage ||
        isFetchingNextPage ||
        pageDiscoveryPending.current ||
        scroller.scrollTop + scroller.clientHeight + PAGE_DISCOVERY_DISTANCE <
          layout.pageLoadBoundaryY
      ) {
        return;
      }
      pageDiscoveryPending.current = true;
      onDiscoverMorePages();
    },
    [hasNextPage, isFetchingNextPage, layout, onDiscoverMorePages],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (layout && scroller) {
      publishVisibleResources(scroller);
    }
  }, [layout, publishVisibleResources]);

  useEffect(() => {
    if (isFetchingNextPage) {
      return;
    }
    pageDiscoveryPending.current = false;
    const scroller = scrollerRef.current;
    if (layout && scroller) {
      discoverMorePages(scroller);
    }
  }, [discoverMorePages, isFetchingNextPage, layout]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    if (lastScrollLeft.current !== scroller.scrollLeft) {
      lastScrollLeft.current = scroller.scrollLeft;
      if (resourceTimer.current) {
        clearTimeout(resourceTimer.current);
      }
      resourceTimer.current = setTimeout(
        () => publishVisibleResources(scroller),
        RESOURCE_SETTLE_MS,
      );
    }
    if (!layout || lastScrollTop.current === scroller.scrollTop) {
      return;
    }
    lastScrollTop.current = scroller.scrollTop;
    setPageViewport({ scrollTop: scroller.scrollTop, height: scroller.clientHeight });
    discoverMorePages(scroller);
    const nextRange = temporalRangeForViewport({
      layout,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
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
        aria-label="Hypermedia timeline"
      >
        <div className="max-w-sm text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 font-semibold">No pages with intervals yet</h2>
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
      aria-label={`Hypermedia timeline with ${layout.pages.length} knowledge pages and ${layout.resources.length} entities and assets`}
    >
      <section
        ref={scrollerRef}
        className="relative size-full overflow-auto overscroll-none"
        aria-label="Timeline viewport"
        onScroll={handleScroll}
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg
            className="absolute inset-0 size-full select-none"
            aria-label="Scrollable page timeline"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
          >
            {layout.ticks.map((tick) => (
              <line
                key={tick.time}
                x1={88}
                y1={tick.y}
                x2={layout.width - 64}
                y2={tick.y}
                className="stroke-border/60"
                strokeDasharray="3 7"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {layout.resources.map((resource) => {
              const active = selectedKey === resource.key || selectedResourceKeys.has(resource.key);
              return (
                <line
                  key={resource.key}
                  x1={resource.x}
                  y1={76}
                  x2={resource.x}
                  y2={layout.height}
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
              const active = activeKey === key;
              const connectedColumns = item.resourceKeys.flatMap((resourceKey) => {
                const column = resourceByKey.get(resourceKey);
                return column ? [column] : [];
              });
              return (
                <HypermediaPageLink
                  key={item.page.readableId}
                  page={item.page}
                  className="transition-opacity duration-100 ease-out motion-reduce:transition-none"
                  style={{
                    opacity: temporalPageOpacity({ bounds: item.bounds, viewport: pageViewport }),
                  }}
                  aria-label={`Open knowledge page ${item.page.title}`}
                  onSelect={onSelect}
                  onPreview={setPreview}
                  onPreviewEnd={clearPreview}
                >
                  <title>{item.page.title}</title>
                  <HypermediaPageCloud
                    path={item.path}
                    colorIndex={item.colorIndex}
                    active={active}
                  />
                  {connectedColumns.map((column) => (
                    <circle
                      key={column.key}
                      cx={column.x}
                      cy={item.label.y}
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
          <TemporalTimeLabels ticks={layout.ticks} width={layout.width} />
          <TemporalResourceHeaders
            resources={layout.resources}
            width={layout.width}
            activeKey={activeKey}
            selectedResourceKeys={selectedResourceKeys}
            onSelect={onSelect}
            onPreview={setPreview}
            onPreviewEnd={clearPreview}
          />
        </div>
      </section>
      <HypermediaHoverPreview preview={preview} selectedKey={selectedKey} className="top-32" />
      {layout.hasOverlappingPages && (
        <Badge
          variant="outline"
          role="note"
          aria-label={OVERLAPPING_PAGES_NOTE}
          className="pointer-events-none absolute right-4 bottom-4 z-30 h-7 gap-1.5 bg-card/95 px-2.5 text-muted-foreground shadow-sm backdrop-blur"
        >
          <Layers2 data-icon="inline-start" aria-hidden="true" />
          {OVERLAPPING_PAGES_NOTE}
        </Badge>
      )}
    </section>
  );
}
