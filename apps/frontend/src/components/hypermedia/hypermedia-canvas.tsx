// biome-ignore-all lint/complexity/useMaxParams: Canvas geometry uses coordinate pairs and pointer anchors.
// biome-ignore-all lint/style/noMagicNumbers: SVG drawing and zoom constants intentionally define the visual geometry.
import { Move } from 'lucide-react';
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CalendarMonth } from '../../lib/calendar-month';
import { cn } from '../../lib/class-names';
import type { HypermediaPages } from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { HypermediaIntervalIndicator } from './hypermedia-interval-indicator';
import {
  buildHypermediaLayout,
  type CanvasBounds,
  HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
  type HypermediaLayout,
  type HypermediaLayoutResource,
  hypermediaLayoutResourceLabel,
  hypermediaLayoutResourceReference,
  initialHypermediaViewBox,
  zoomedHypermediaViewBox,
} from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
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
import {
  focusedResources,
  hypermediaLayoutInViewport,
  nearestBoundaryResource,
  viewportNeedsResourceDiscovery,
} from './hypermedia-visibility';
import { useHypermediaIntervalScroll } from './use-hypermedia-interval-scroll';

type ViewBox = CanvasBounds;

const MAX_WHEEL_ZOOM_DELTA = 80;
const WHEEL_ZOOM_RATE = 0.0032;
const VIEWPORT_SETTLE_MS = 280;

function ResourceDot({
  resource,
  active,
  onActivate,
  onPreview,
  onPreviewEnd,
}: {
  resource: HypermediaLayoutResource;
  active: boolean;
  onActivate: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
}) {
  const label = hypermediaLayoutResourceLabel(resource);
  const reference = hypermediaLayoutResourceReference(resource);
  const href = `/${reference.kind === 'entity' ? 'entities' : 'assets'}/${encodeURIComponent(reference.readableId)}`;

  return (
    <a
      href={href}
      data-hypermedia-resource
      aria-label={`Open ${resource.kind} ${label}`}
      className="cursor-pointer outline-none"
      onPointerEnter={onPreview}
      onPointerLeave={onPreviewEnd}
      onFocus={onPreview}
      onBlur={onPreviewEnd}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
    >
      <HypermediaResourceNode point={resource.point} resource={resource} active={active} />
    </a>
  );
}

const HypermediaScene = memo(function HypermediaScene({
  layout,
  activeKey,
  selectedResourceKeys,
  suppressNextCloudClick,
  onSelect,
  onPreview,
  onPreviewEnd,
}: {
  layout: HypermediaLayout;
  activeKey: string | undefined;
  selectedResourceKeys: Set<string>;
  suppressNextCloudClick: { current: boolean };
  onSelect: (selection: HypermediaSelection) => void;
  onPreview: (preview: HypermediaPreview) => void;
  onPreviewEnd: (key: string) => void;
}) {
  return (
    <>
      {layout.pages.map((item) => {
        const key = hypermediaSelectionKey({ kind: 'page', readableId: item.page.readableId });
        const active = activeKey === key;
        return (
          <HypermediaPageLink
            key={item.page.readableId}
            page={item.page}
            tabIndex={-1}
            aria-label={`Open knowledge page region ${item.page.title}`}
            data-hypermedia-cloud={item.page.readableId}
            onSelect={onSelect}
            shouldSelect={() => {
              if (suppressNextCloudClick.current) {
                suppressNextCloudClick.current = false;
                return false;
              }
              return true;
            }}
            onPreview={onPreview}
            onPreviewEnd={onPreviewEnd}
          >
            <HypermediaPageCloud
              path={item.cloudPath}
              colorIndex={item.colorIndex}
              active={active}
            />
          </HypermediaPageLink>
        );
      })}

      {layout.pages.map((item) => {
        const key = hypermediaSelectionKey({ kind: 'page', readableId: item.page.readableId });
        const active = activeKey === key;
        return (
          <HypermediaPageLink
            key={item.page.readableId}
            page={item.page}
            data-hypermedia-resource
            aria-label={`Open knowledge page ${item.page.title}`}
            onSelect={onSelect}
            onPreview={onPreview}
            onPreviewEnd={onPreviewEnd}
          >
            <HypermediaPageLabel
              page={item.page}
              point={item.point}
              active={active}
              maximumCharacters={HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS}
            />
          </HypermediaPageLink>
        );
      })}

      {layout.resources.map((resource) => {
        const preview =
          resource.kind === 'entity'
            ? ({ kind: 'entity', entity: resource.entity } as const)
            : ({ kind: 'asset', asset: resource.asset } as const);
        return (
          <ResourceDot
            key={resource.key}
            resource={resource}
            active={activeKey === resource.key || selectedResourceKeys.has(resource.key)}
            onPreview={() => onPreview(preview)}
            onPreviewEnd={() => onPreviewEnd(resource.key)}
            onActivate={() => onSelect(hypermediaLayoutResourceReference(resource))}
          />
        );
      })}
    </>
  );
});

function HypermediaExplorationCue({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
      role="status"
    >
      {error ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-events-auto rounded-full bg-card/92 shadow-sm backdrop-blur"
          onClick={onRetry}
        >
          Retry loading nearby resources
        </Button>
      ) : (
        <p className="flex items-center gap-2 whitespace-nowrap rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur">
          <Move className="size-3.5" aria-hidden="true" />
          Drag to move, pinch to zoom, and scroll through time.
        </p>
      )}
    </div>
  );
}

export function HypermediaCanvas({
  resources,
  pages,
  month,
  temporalExtent,
  selectedResources,
  selectedKey,
  onSelect,
  onViewportSettled,
  onMonthChange,
  onIntervalScrollingChange,
  canExplore,
  isInitialLoading,
  neighborhoodError,
  onRetryNeighborhood,
}: HypermediaViewProps & {
  canExplore: boolean;
  isInitialLoading: boolean;
  neighborhoodError: Error | null;
  onRetryNeighborhood: () => void;
  month?: CalendarMonth;
  temporalExtent: HypermediaPages['temporalExtent'];
  onMonthChange: (month?: CalendarMonth) => void;
  onIntervalScrollingChange: (scrolling: boolean) => void;
}) {
  const [viewBox, setViewBox] = useState<ViewBox>(() =>
    initialHypermediaViewBox(buildHypermediaLayout(resources, [])),
  );
  const { activeKey, clearPreview, preview, selectedResourceKeys, setPreview } =
    useHypermediaViewState({ selectedResources, selectedKey });
  const spotlightActive = selectedResources.length > 0;
  const layout = useMemo(() => buildHypermediaLayout(resources, pages), [pages, resources]);
  const viewBoxRef = useRef(viewBox);
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalScroll = useHypermediaIntervalScroll({
    month,
    onMonthChange,
    onIntervalScrollingChange,
  });
  const [panning, setPanning] = useState(false);
  const [showExplorationHint, setShowExplorationHint] = useState(true);
  const suppressNextCloudClick = useRef(false);
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewBox: ViewBox;
    currentViewBox: ViewBox;
    moved: boolean;
    cloudReadableId?: string;
  } | null>(null);
  const visibleLayout = useMemo(
    () =>
      spotlightActive
        ? layout
        : hypermediaLayoutInViewport({ layout, viewport: viewBox, selectedKey }),
    [layout, selectedKey, spotlightActive, viewBox],
  );
  const updateViewBox = useCallback((nextViewBox: ViewBox) => {
    viewBoxRef.current = nextViewBox;
    setViewBox(nextViewBox);
  }, []);

  const publishViewport = useCallback(
    ({ viewport, includeBoundary }: { viewport: ViewBox; includeBoundary: boolean }) => {
      const focus = focusedResources({ resources: layout.resources, viewport, selectedKey });
      const discoverMoreEntities =
        includeBoundary &&
        viewportNeedsResourceDiscovery({
          resources: layout.resources,
          viewport,
          bounds: layout.resourceBounds,
        });
      const boundaryAnchor = discoverMoreEntities
        ? nearestBoundaryResource(layout.resources, viewport)
        : undefined;
      if (focus.length === 0 && !discoverMoreEntities) {
        return;
      }
      onViewportSettled({
        focus,
        discoverMoreEntities,
        boundaryAnchor,
      });
    },
    [layout.resourceBounds, layout.resources, onViewportSettled, selectedKey],
  );

  const scheduleViewport = useCallback(
    ({ viewport, includeBoundary }: { viewport: ViewBox; includeBoundary: boolean }) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(
        () => publishViewport({ viewport, includeBoundary }),
        VIEWPORT_SETTLE_MS,
      );
    },
    [publishViewport],
  );

  useEffect(() => {
    if (spotlightActive) {
      return;
    }
    const viewport = viewBoxRef.current;
    publishViewport({ viewport, includeBoundary: true });
    return () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    };
  }, [publishViewport, spotlightActive]);

  function zoom(factor: number, anchor = { x: 0.5, y: 0.5 }) {
    setShowExplorationHint(false);
    const current = viewBoxRef.current;
    const minimumWidth = 260;
    const maximumWidth = Math.max(2400, layout.resourceBounds.width * 2.5);
    const nextViewBox = zoomedHypermediaViewBox({
      current,
      factor,
      anchor,
      minimumWidth,
      maximumWidth,
    });
    if (nextViewBox === current) {
      return;
    }
    updateViewBox(nextViewBox);
    if (!spotlightActive) {
      scheduleViewport({ viewport: nextViewBox, includeBoundary: true });
    }
  }

  function handlePinchZoom(event: globalThis.WheelEvent) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const boundedDelta = Math.max(
      -MAX_WHEEL_ZOOM_DELTA,
      Math.min(MAX_WHEEL_ZOOM_DELTA, event.deltaY),
    );
    zoom(Math.exp(boundedDelta * WHEEL_ZOOM_RATE), {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  const handleWheel = useEffectEvent((event: globalThis.WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey) {
      handlePinchZoom(event);
      return;
    }
    intervalScroll.handleWheel({ event, viewportHeight: canvasRef.current?.clientHeight ?? 1 });
    setShowExplorationHint(false);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('[data-hypermedia-resource]')) {
      return;
    }
    suppressNextCloudClick.current = false;
    const cloudReadableId = (event.target as Element)
      .closest('[data-hypermedia-cloud]')
      ?.getAttribute('data-hypermedia-cloud');
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox,
      currentViewBox: viewBox,
      moved: false,
      cloudReadableId: cloudReadableId ?? undefined,
    };
    setPanning(true);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.current.clientX) / rect.width) * drag.current.viewBox.width;
    const dy = ((event.clientY - drag.current.clientY) / rect.height) * drag.current.viewBox.height;
    if (
      !drag.current.moved &&
      Math.abs(event.clientX - drag.current.clientX) +
        Math.abs(event.clientY - drag.current.clientY) >
        4
    ) {
      drag.current.moved = true;
      setShowExplorationHint(false);
    }
    const currentViewBox = {
      ...drag.current.viewBox,
      x: drag.current.viewBox.x - dx,
      y: drag.current.viewBox.y - dy,
    };
    drag.current.currentViewBox = currentViewBox;
    updateViewBox(currentViewBox);
  }

  function handlePointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      const completedDrag = drag.current;
      suppressNextCloudClick.current =
        completedDrag.moved || Boolean(completedDrag.cloudReadableId);
      if (!completedDrag.moved && completedDrag.cloudReadableId) {
        onSelect({ kind: 'page', readableId: completedDrag.cloudReadableId });
      }
      drag.current = null;
      setPanning(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (completedDrag.moved && !spotlightActive) {
        scheduleViewport({ viewport: completedDrag.currentViewBox, includeBoundary: true });
      }
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    suppressNextCloudClick.current = true;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section
      className="relative size-full min-h-[28rem] overflow-hidden overscroll-none bg-card"
      aria-label={`Hypermedia with ${visibleLayout.pages.length} visible knowledge pages and ${visibleLayout.resources.length} visible entities and assets`}
    >
      <svg
        ref={canvasRef}
        className={cn(
          'size-full touch-none select-none bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        aria-label="Interactive Hypermedia"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
      >
        <HypermediaScene
          layout={visibleLayout}
          activeKey={activeKey}
          selectedResourceKeys={selectedResourceKeys}
          suppressNextCloudClick={suppressNextCloudClick}
          onSelect={onSelect}
          onPreview={setPreview}
          onPreviewEnd={clearPreview}
        />
      </svg>

      {!selectedKey && (
        <HypermediaIntervalIndicator
          month={intervalScroll.displayedMonth}
          extent={temporalExtent}
          scrollProgress={intervalScroll.progress}
          scrolling={intervalScroll.scrolling}
        />
      )}

      {!isInitialLoading && (neighborhoodError || (canExplore && showExplorationHint)) && (
        <HypermediaExplorationCue error={neighborhoodError} onRetry={onRetryNeighborhood} />
      )}

      {isInitialLoading && (
        <div
          className="absolute right-4 bottom-4 rounded-full border bg-card/92 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur"
          aria-live="polite"
        >
          Loading nearby resources…
        </div>
      )}

      <HypermediaHoverPreview preview={preview} selectedKey={selectedKey} className="top-4" />
    </section>
  );
}
