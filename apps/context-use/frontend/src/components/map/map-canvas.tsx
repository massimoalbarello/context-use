// biome-ignore-all lint/complexity/useMaxParams: Canvas geometry uses coordinate pairs and pointer anchors.
// biome-ignore-all lint/style/noMagicNumbers: SVG drawing and zoom constants intentionally define the visual geometry.

import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
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
import { type MapPage, mapEntityKey, mapEntityReference } from '../../queries/map';
import { MapIntervalIndicator } from './map-interval-indicator';
import {
  buildMapLayout,
  type CanvasBounds,
  type CanvasPoint,
  initialMapViewBox,
  type MapLayout,
  type MapLayoutEntity,
  zoomedMapViewBox,
} from './map-layout';
import { type MapSelection, mapSelectionKey } from './map-selection';
import {
  MapEntityNode,
  MapHoverPreview,
  MapPageCloud,
  MapPageLabel,
  MapPageLink,
  type MapPreview,
  mapPreviewKey,
} from './map-view';
import {
  focusedEntities,
  mapLayoutInViewport,
  nearestBoundaryEntity,
  type SettledMapViewport,
  viewportNeedsEntityDiscovery,
} from './map-visibility';
import { useMapIntervalScroll } from './use-map-interval-scroll';

type ViewBox = CanvasBounds;

const MAX_WHEEL_ZOOM_DELTA = 80;
const WHEEL_ZOOM_RATE = 0.0046;
const VIEWPORT_SETTLE_MS = 280;

function EntityDot({
  entity,
  active,
  muted,
  onActivate,
  onPreview,
  onPreviewEnd,
}: {
  entity: MapLayoutEntity;
  active: boolean;
  muted: boolean;
  onActivate: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
}) {
  const label = entity.entity.name;
  const reference = mapEntityReference(entity.entity);
  const href = `/app/entities/${encodeURIComponent(reference.readableId)}`;

  return (
    <a
      href={href}
      data-map-item
      aria-label={`Open entity ${label}`}
      className="cursor-pointer outline-none transition-[opacity,filter] duration-200 motion-reduce:transition-none"
      style={{ opacity: muted ? 0.5 : 1, filter: muted ? 'grayscale(1)' : undefined }}
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
      <MapEntityNode entity={entity} active={active} />
    </a>
  );
}

const MapScene = memo(function MapScene({
  layout,
  activeKey,
  emphasizedEntityKeys,
  suppressNextCloudClick,
  onSelect,
  onPreview,
  onPreviewEnd,
}: {
  layout: MapLayout;
  activeKey: string | undefined;
  emphasizedEntityKeys: ReadonlySet<string> | undefined;
  suppressNextCloudClick: { current: boolean };
  onSelect: (selection: MapSelection) => void;
  onPreview: (preview: MapPreview) => void;
  onPreviewEnd: (key: string) => void;
}) {
  return (
    <>
      {layout.pages.map((item) => {
        const key = mapSelectionKey({ kind: 'page', readableId: item.page.readableId });
        const active = activeKey === key;
        return (
          <MapPageLink
            key={item.page.readableId}
            page={item.page}
            tabIndex={-1}
            aria-label={`Open knowledge page region ${item.page.title}`}
            data-map-cloud={item.page.readableId}
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
            <MapPageCloud path={item.cloudPath} active={active} />
          </MapPageLink>
        );
      })}

      {layout.pages.map((item) => {
        const key = mapSelectionKey({ kind: 'page', readableId: item.page.readableId });
        const active = activeKey === key;
        return (
          <MapPageLink
            key={item.page.readableId}
            page={item.page}
            data-map-item
            aria-label={`Open knowledge page ${item.page.title}`}
            onSelect={onSelect}
            onPreview={onPreview}
            onPreviewEnd={onPreviewEnd}
          >
            <MapPageLabel page={item.page} point={item.point} active={active} />
          </MapPageLink>
        );
      })}

      {layout.entities.map((entity) => {
        const preview = { kind: 'entity', entity: entity.entity } as const;
        return (
          <EntityDot
            key={entity.key}
            entity={entity}
            active={activeKey === entity.key}
            muted={Boolean(emphasizedEntityKeys && !emphasizedEntityKeys.has(entity.key))}
            onPreview={() => onPreview(preview)}
            onPreviewEnd={() => onPreviewEnd(entity.key)}
            onActivate={() => onSelect({ kind: 'entity', ...mapEntityReference(entity.entity) })}
          />
        );
      })}
    </>
  );
});

function MapExplorationCue({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div
      className="pointer-events-none absolute right-4 bottom-4 left-4 z-10 flex justify-center"
      role="status"
    >
      {error ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          shape="round"
          className="pointer-events-auto h-auto max-w-full whitespace-normal py-2 shadow-sm"
          onClick={onRetry}
        >
          Retry loading nearby entities
        </Button>
      ) : (
        <p className="flex items-center gap-2 rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur">
          <Move className="size-3.5 shrink-0" aria-hidden="true" />
          Drag to move, pinch to zoom, and scroll through time.
        </p>
      )}
    </div>
  );
}

export function MapCanvas({
  entities,
  pages,
  month,
  selectedKey,
  onSelect,
  onViewportSettled,
  onMonthChange,
  onIntervalScrollingChange,
  canExplore,
  isInitialLoading,
  neighborhoodError,
  onRetryNeighborhood,
}: {
  entities: MapLayoutEntity[];
  pages: MapPage[];
  selectedKey?: string;
  onSelect: (selection: MapSelection) => void;
  onViewportSettled: (viewport: SettledMapViewport) => void;
  canExplore: boolean;
  isInitialLoading: boolean;
  neighborhoodError: Error | null;
  onRetryNeighborhood: () => void;
  month?: CalendarMonth;
  onMonthChange: (month?: CalendarMonth) => void;
  onIntervalScrollingChange: (scrolling: boolean) => void;
}) {
  const [viewBox, setViewBox] = useState<ViewBox>(() => initialMapViewBox(entities));
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const activeKey = preview ? mapPreviewKey(preview) : selectedKey;
  const emphasizedPage =
    preview?.kind === 'page'
      ? preview.page
      : pages.find(
          (page) => mapSelectionKey({ kind: 'page', readableId: page.readableId }) === selectedKey,
        );
  const emphasizedEntityKeys = useMemo(
    () => (emphasizedPage ? new Set(emphasizedPage.entities.map(mapEntityKey)) : undefined),
    [emphasizedPage],
  );
  const clearPreview = useCallback((key: string) => {
    setPreview((current) => (current && mapPreviewKey(current) === key ? null : current));
  }, []);
  const layout = useMemo(() => buildMapLayout(entities, pages), [pages, entities]);
  const viewBoxRef = useRef(viewBox);
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalScroll = useMapIntervalScroll({
    month,
    onMonthChange,
    onIntervalScrollingChange,
  });
  const [panning, setPanning] = useState(false);
  const [showExplorationHint, setShowExplorationHint] = useState(true);
  const suppressNextCloudClick = useRef(false);
  const touches = useRef(new Map<number, CanvasPoint>());
  const suppressTouchClick = useRef(false);
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
    () => mapLayoutInViewport({ layout, viewport: viewBox }),
    [layout, viewBox],
  );
  const updateViewBox = useCallback((nextViewBox: ViewBox) => {
    viewBoxRef.current = nextViewBox;
    setViewBox(nextViewBox);
  }, []);

  const publishViewport = useCallback(
    (viewport: ViewBox) => {
      const focus = focusedEntities({ entities: layout.entities, viewport });
      const discoverMoreEntities = viewportNeedsEntityDiscovery({
        entities: layout.entities,
        viewport,
        bounds: layout.entityBounds,
      });
      const boundaryAnchor = discoverMoreEntities
        ? nearestBoundaryEntity(layout.entities, viewport)
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
    [layout.entityBounds, layout.entities, onViewportSettled],
  );

  const scheduleViewport = useCallback(
    (viewport: ViewBox) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
      settleTimer.current = setTimeout(() => publishViewport(viewport), VIEWPORT_SETTLE_MS);
    },
    [publishViewport],
  );

  useEffect(() => {
    const viewport = viewBoxRef.current;
    publishViewport(viewport);
    return () => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
      }
    };
  }, [publishViewport]);

  function zoom(factor: number, anchor = { x: 0.5, y: 0.5 }) {
    setShowExplorationHint(false);
    const current = viewBoxRef.current;
    const minimumWidth = 260;
    const maximumWidth = Math.max(2400, layout.entityBounds.width * 2.5);
    const nextViewBox = zoomedMapViewBox({
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
    scheduleViewport(nextViewBox);
  }

  function canvasAnchor(point: CanvasPoint) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const current = viewBoxRef.current;
    // The SVG uses xMidYMid meet, so portrait screens have space above and below the viewBox.
    const scale = Math.min(rect.width / current.width, rect.height / current.height);
    return {
      x: (point.x - rect.left - rect.width / 2) / (current.width * scale) + 0.5,
      y: (point.y - rect.top - rect.height / 2) / (current.height * scale) + 0.5,
    };
  }

  function handlePinchZoom(event: globalThis.WheelEvent) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const boundedDelta = Math.max(
      -MAX_WHEEL_ZOOM_DELTA,
      Math.min(MAX_WHEEL_ZOOM_DELTA, event.deltaY),
    );
    zoom(
      Math.exp(boundedDelta * WHEEL_ZOOM_RATE),
      canvasAnchor({ x: event.clientX, y: event.clientY }),
    );
  }

  const handleWheel = useEffectEvent((event: globalThis.WheelEvent) => {
    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      handlePinchZoom(event);
      return;
    }
    if (event.target instanceof Element && event.target.closest('[data-rwp]')) {
      return;
    }
    event.preventDefault();
    intervalScroll.handleWheel({ event, viewportHeight: canvasRef.current?.clientHeight ?? 1 });
    setShowExplorationHint(false);
  });

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    surface.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => surface.removeEventListener('wheel', handleWheel, { capture: true });
  }, []);

  function beginTouch(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== 'touch' || touches.current.size === 0) {
      suppressTouchClick.current = false;
    }
    if (event.pointerType !== 'touch') {
      return false;
    }
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size < 2) {
      return false;
    }
    for (const pointerId of touches.current.keys()) {
      event.currentTarget.setPointerCapture(pointerId);
    }
    drag.current = null;
    suppressTouchClick.current = true;
    suppressNextCloudClick.current = true;
    setPreview(null);
    setPanning(true);
    return true;
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (beginTouch(event)) {
      return;
    }
    if (event.button !== 0 || (event.target as Element).closest('[data-map-item]')) {
      return;
    }
    suppressNextCloudClick.current = false;
    const cloudReadableId = (event.target as Element)
      .closest('[data-map-cloud]')
      ?.getAttribute('data-map-cloud');
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox: viewBoxRef.current,
      currentViewBox: viewBoxRef.current,
      moved: false,
      cloudReadableId: cloudReadableId ?? undefined,
    };
    setPanning(true);
  }

  function moveTouch(event: ReactPointerEvent<SVGSVGElement>) {
    if (!touches.current.has(event.pointerId)) {
      return false;
    }
    const [a, b] = touches.current.values();
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [c, d] = touches.current.values();
    if (!a || !b || !c || !d) {
      return false;
    }
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const nextDistance = Math.hypot(c.x - d.x, c.y - d.y);
    if (distance > 0 && nextDistance > 0) {
      zoom(distance / nextDistance, canvasAnchor({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
      const current = viewBoxRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / current.width, rect.height / current.height);
      const nextViewBox = {
        ...current,
        x: current.x - (c.x + d.x - a.x - b.x) / (2 * scale),
        y: current.y - (c.y + d.y - a.y - b.y) / (2 * scale),
      };
      updateViewBox(nextViewBox);
      scheduleViewport(nextViewBox);
    }
    return true;
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (moveTouch(event)) {
      return;
    }
    if (!drag.current || drag.current.pointerId !== event.pointerId) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(
      rect.width / drag.current.viewBox.width,
      rect.height / drag.current.viewBox.height,
    );
    const dx = (event.clientX - drag.current.clientX) / scale;
    const dy = (event.clientY - drag.current.clientY) / scale;
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

  function endTouch(event: ReactPointerEvent<SVGSVGElement>) {
    touches.current.delete(event.pointerId);
    if (!suppressTouchClick.current || event.pointerType !== 'touch') {
      return false;
    }
    const remaining = touches.current.entries().next().value;
    drag.current = remaining
      ? {
          pointerId: remaining[0],
          clientX: remaining[1].x,
          clientY: remaining[1].y,
          viewBox: viewBoxRef.current,
          currentViewBox: viewBoxRef.current,
          moved: true,
        }
      : null;
    setPanning(touches.current.size > 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    scheduleViewport(viewBoxRef.current);
    return true;
  }

  function handlePointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (endTouch(event)) {
      return;
    }
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
      if (completedDrag.moved) {
        scheduleViewport(completedDrag.currentViewBox);
      }
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<SVGSVGElement>) {
    if (endTouch(event)) {
      return;
    }
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
      ref={surfaceRef}
      className="relative size-full min-h-[28rem] overflow-hidden overscroll-none bg-card"
      aria-label={`Map with ${visibleLayout.pages.length} visible knowledge pages and ${visibleLayout.entities.length} visible entities`}
    >
      <svg
        ref={canvasRef}
        className={cn(
          'size-full touch-none select-none bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        aria-label="Interactive map"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={(event) => {
          // Recapturing a touch from a child link also bubbles a lost-capture event.
          if (event.target === event.currentTarget) {
            handlePointerCancel(event);
          }
        }}
        onClickCapture={(event) => {
          if (suppressTouchClick.current && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <MapScene
          layout={visibleLayout}
          activeKey={activeKey}
          emphasizedEntityKeys={emphasizedEntityKeys}
          suppressNextCloudClick={suppressNextCloudClick}
          onSelect={onSelect}
          onPreview={setPreview}
          onPreviewEnd={clearPreview}
        />
      </svg>

      {!selectedKey && (
        <MapIntervalIndicator
          month={intervalScroll.displayedMonth}
          onMonthChange={intervalScroll.selectMonth}
        />
      )}

      {!isInitialLoading && (neighborhoodError || (canExplore && showExplorationHint)) && (
        <MapExplorationCue error={neighborhoodError} onRetry={onRetryNeighborhood} />
      )}

      {isInitialLoading && (
        <div
          className="absolute right-4 bottom-4 rounded-full border bg-card/92 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur"
          aria-live="polite"
        >
          Loading nearby entities…
        </div>
      )}

      <MapHoverPreview preview={preview} selectedKey={selectedKey} />
    </section>
  );
}
