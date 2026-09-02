// biome-ignore-all lint/complexity/useMaxParams: Canvas geometry uses coordinate pairs and pointer anchors.
// biome-ignore-all lint/style/noMagicNumbers: SVG drawing and zoom constants intentionally define the visual geometry.
import { File, FileText, Minus, Move, Plus, Scan } from 'lucide-react';
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type {
  KnowledgeMapAsset,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../queries/knowledge-map';
import { formatAssetSize } from '../assets/asset-link';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  buildKnowledgeMapLayout,
  eagerKnowledgeMapImageKeys,
  focusedKnowledgeMapViewBox,
  type KnowledgeMapLayout,
  type KnowledgeMapResource,
  knowledgeMapLayoutInViewport,
  mapViewportNearBoundary,
} from './knowledge-map-layout';

type MapPreview =
  | { kind: 'page'; page: KnowledgeMapPage }
  | { kind: 'entity'; entity: KnowledgeMapEntity }
  | { kind: 'asset'; asset: KnowledgeMapAsset };

type ViewBox = { x: number; y: number; width: number; height: number };

const BUTTON_ZOOM_IN_FACTOR = 0.9;
const BUTTON_ZOOM_OUT_FACTOR = 1.1;
const MAX_WHEEL_ZOOM_DELTA = 80;
const WHEEL_ZOOM_RATE = 0.001;
const ZOOM_LOAD_THROTTLE_MS = 400;

export type KnowledgeMapSelection = {
  kind: 'page' | 'entity' | 'asset';
  readableId: string;
};

export function mapPointerEndAction({
  moved,
  cloudReadableId,
  canLoadMore,
  nearBoundary,
}: {
  moved: boolean;
  cloudReadableId?: string;
  canLoadMore: boolean;
  nearBoundary: boolean;
}): {
  selectedPageReadableId?: string;
  suppressCloudClick: boolean;
  loadMore: boolean;
} {
  return {
    selectedPageReadableId: moved ? undefined : cloudReadableId,
    suppressCloudClick: moved || Boolean(cloudReadableId),
    loadMore: moved && canLoadMore && nearBoundary,
  };
}

function previewKey(preview: MapPreview): string {
  if (preview.kind === 'page') {
    return `page:${preview.page.readableId}`;
  }
  if (preview.kind === 'entity') {
    return `entity:${preview.entity.readableId}`;
  }
  return `asset:${preview.asset.readableId}`;
}

function shortLabel(value: string, length = 24): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

function PreviewCard({ preview }: { preview: MapPreview }) {
  if (preview.kind === 'page') {
    const { page } = preview;
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-5 stroke-[1.5]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Badge variant="secondary">Knowledge page</Badge>
            <h2 className="mt-1 truncate font-semibold text-base">{page.title}</h2>
          </div>
        </div>
        <p className="line-clamp-3 text-muted-foreground text-sm leading-relaxed">
          {page.excerpt || 'This page has no excerpt.'}
        </p>
      </div>
    );
  }
  if (preview.kind === 'entity') {
    const { entity } = preview;
    return (
      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-lg">
          {entity.image ? (
            <img
              src={assetContentUrl(entity.image.readableId)}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            entity.name.trim().charAt(0).toLocaleUpperCase() || '?'
          )}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Entity</Badge>
            {entity.isSelf && <Badge variant="secondary">You</Badge>}
          </div>
          <h2 className="mt-2 truncate font-semibold text-base">{entity.name}</h2>
          <p className="mt-1 line-clamp-3 text-muted-foreground text-sm leading-relaxed">
            {entity.description}
          </p>
        </div>
      </div>
    );
  }

  const { asset } = preview;
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {isEmbeddableAsset(asset) ? (
          <img src={assetContentUrl(asset.readableId)} alt="" className="size-full object-cover" />
        ) : (
          <File className="size-6 stroke-[1.4]" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        <Badge variant="secondary">Asset</Badge>
        <h2 className="mt-2 truncate font-semibold text-base">{asset.name}</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {asset.extension?.toUpperCase() ?? asset.mediaType} · {formatAssetSize(asset.sizeBytes)}
        </p>
      </div>
    </div>
  );
}

function mapResourceImageReadableId(
  resource: KnowledgeMapResource,
  visible: boolean,
): string | undefined {
  if (!visible) {
    return undefined;
  }
  if (resource.kind === 'entity') {
    return resource.entity.image?.readableId;
  }
  return isEmbeddableAsset(resource.asset) ? resource.asset.readableId : undefined;
}

function resourceDotEmphasis({ active, isSelf }: { active: boolean; isSelf: boolean }): {
  radiusOffset: number;
  strokeWidth: number;
} {
  if (active) {
    return { radiusOffset: 5, strokeWidth: 5 };
  }
  return isSelf ? { radiusOffset: 3, strokeWidth: 4 } : { radiusOffset: 1, strokeWidth: 2 };
}

function ResourceDot({
  resource,
  active,
  eagerImage,
  onActivate,
  onPreview,
  onPreviewEnd,
}: {
  resource: KnowledgeMapResource;
  active: boolean;
  eagerImage: boolean;
  onActivate: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
}) {
  const radius = resource.kind === 'entity' ? 25 : 22;
  const isSelf = resource.kind === 'entity' && resource.entity.isSelf;
  const emphasis = resourceDotEmphasis({ active, isSelf });
  const outerExtent = radius + emphasis.radiusOffset;
  const innerExtent = radius - 3;
  const imageReadableId = mapResourceImageReadableId(resource, active || eagerImage);
  const label = resource.kind === 'entity' ? resource.entity.name : resource.asset.name;
  const readableId =
    resource.kind === 'entity' ? resource.entity.readableId : resource.asset.readableId;
  const clipId = `map-dot-${resource.key.replaceAll(':', '-')}`;
  const href = `/${resource.kind === 'entity' ? 'entities' : 'assets'}/${encodeURIComponent(readableId)}`;

  return (
    <a
      href={href}
      data-map-resource
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
      <defs>
        <clipPath id={clipId}>
          {resource.kind === 'entity' ? (
            <circle cx={resource.point.x} cy={resource.point.y} r={innerExtent} />
          ) : (
            <rect
              x={resource.point.x - innerExtent}
              y={resource.point.y - innerExtent}
              width={innerExtent * 2}
              height={innerExtent * 2}
              rx={7}
            />
          )}
        </clipPath>
      </defs>
      {resource.kind === 'entity' ? (
        <circle
          cx={resource.point.x}
          cy={resource.point.y}
          r={outerExtent}
          className={cn(
            'fill-card stroke-border transition-[r,stroke-width] motion-reduce:transition-none',
            (active || isSelf) && 'stroke-foreground',
          )}
          strokeWidth={emphasis.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <rect
          x={resource.point.x - outerExtent}
          y={resource.point.y - outerExtent}
          width={outerExtent * 2}
          height={outerExtent * 2}
          rx={10}
          className={cn(
            'fill-card stroke-border transition-[x,y,width,height,stroke-width] motion-reduce:transition-none',
            active && 'stroke-foreground',
          )}
          strokeWidth={emphasis.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {imageReadableId ? (
        <image
          href={assetContentUrl(imageReadableId)}
          x={resource.point.x - radius + 3}
          y={resource.point.y - radius + 3}
          width={(radius - 3) * 2}
          height={(radius - 3) * 2}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      ) : resource.kind === 'entity' ? (
        <text
          x={resource.point.x}
          y={resource.point.y + 6}
          textAnchor="middle"
          className="fill-foreground font-semibold text-lg"
        >
          {resource.entity.name.trim().charAt(0).toLocaleUpperCase() || '?'}
        </text>
      ) : (
        <g
          transform={`translate(${resource.point.x - 9} ${resource.point.y - 11})`}
          className="fill-none stroke-[1.7] stroke-muted-foreground"
        >
          <path d="M4 1.5h8l5 5v14H4z" />
          <path d="M12 1.5v5h5" />
        </g>
      )}
      <text
        x={resource.point.x}
        y={resource.point.y + radius + 18}
        textAnchor="middle"
        className="pointer-events-none fill-foreground font-medium text-[12px]"
      >
        {shortLabel(label, 22)}
      </text>
    </a>
  );
}

const KnowledgeMapLayers = memo(function KnowledgeMapLayers({
  layout,
  activeKey,
  eagerImageKeys,
  suppressNextCloudClick,
  onSelect,
  onPreview,
  onPreviewEnd,
}: {
  layout: KnowledgeMapLayout;
  activeKey: string | undefined;
  eagerImageKeys: Set<string>;
  suppressNextCloudClick: { current: boolean };
  onSelect: (selection: KnowledgeMapSelection) => void;
  onPreview: (preview: MapPreview) => void;
  onPreviewEnd: (key: string) => void;
}) {
  return (
    <>
      {layout.pages.map((item) => {
        const key = `page:${item.page.readableId}`;
        const active = activeKey === key;
        return (
          <a
            key={item.page.readableId}
            href={`/pages/${encodeURIComponent(item.page.readableId)}?view=preview`}
            tabIndex={-1}
            aria-label={`Open knowledge page region ${item.page.title}`}
            data-map-cloud={item.page.readableId}
            className="cursor-pointer outline-none"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (suppressNextCloudClick.current) {
                suppressNextCloudClick.current = false;
                return;
              }
              onSelect({ kind: 'page', readableId: item.page.readableId });
            }}
            onPointerEnter={() => onPreview({ kind: 'page', page: item.page })}
            onPointerLeave={() => onPreviewEnd(key)}
          >
            <path
              d={item.cloudPath}
              className="transition-[fill-opacity,stroke-opacity] duration-200 motion-reduce:transition-none"
              style={{
                color: `var(--chart-${item.colorIndex})`,
                fill: 'currentColor',
                fillOpacity: active ? 0.24 : 0.1,
                stroke: 'currentColor',
                strokeOpacity: active ? 0.9 : 0.48,
                strokeWidth: active ? 3 : 1.5,
              }}
            />
          </a>
        );
      })}

      {layout.pages.map((item) => {
        const key = `page:${item.page.readableId}`;
        const active = activeKey === key;
        return (
          <a
            key={item.page.readableId}
            href={`/pages/${encodeURIComponent(item.page.readableId)}?view=preview`}
            data-map-resource
            aria-label={`Open knowledge page ${item.page.title}`}
            className="cursor-pointer outline-none"
            onPointerEnter={() => onPreview({ kind: 'page', page: item.page })}
            onPointerLeave={() => onPreviewEnd(key)}
            onFocus={() => onPreview({ kind: 'page', page: item.page })}
            onBlur={() => onPreviewEnd(key)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect({ kind: 'page', readableId: item.page.readableId });
            }}
          >
            <text
              x={item.point.x}
              y={item.point.y + 4}
              textAnchor="middle"
              className={cn(
                'fill-foreground stroke-[7] stroke-card font-semibold text-[13px] [paint-order:stroke] [stroke-linejoin:round]',
                active && 'underline decoration-2 underline-offset-4',
              )}
            >
              {shortLabel(item.page.title, 28)}
            </text>
          </a>
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
            active={activeKey === resource.key}
            eagerImage={eagerImageKeys.has(resource.key)}
            onPreview={() => onPreview(preview)}
            onPreviewEnd={() => onPreviewEnd(resource.key)}
            onActivate={() => {
              if (resource.kind === 'entity') {
                onSelect({ kind: 'entity', readableId: resource.entity.readableId });
              } else {
                onSelect({ kind: 'asset', readableId: resource.asset.readableId });
              }
            }}
          />
        );
      })}
    </>
  );
});

function KnowledgeMapExplorationCue({
  loadMoreError,
  onLoadMore,
}: {
  loadMoreError: Error | null;
  onLoadMore: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
      role="status"
    >
      {loadMoreError ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-events-auto rounded-full bg-card/92 shadow-sm backdrop-blur"
          onClick={onLoadMore}
        >
          Retry loading nearby pages
        </Button>
      ) : (
        <p className="flex items-center gap-2 whitespace-nowrap rounded-full border bg-card/92 px-3 py-2 text-muted-foreground text-xs shadow-sm backdrop-blur">
          <Move className="size-3.5" aria-hidden="true" />
          Drag or zoom out for more pages
        </p>
      )}
    </div>
  );
}

export function KnowledgeMapCanvas({
  pages,
  anchorEntity,
  selectedKey,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
}: {
  pages: KnowledgeMapPage[];
  anchorEntity: KnowledgeMapEntity;
  selectedKey?: string;
  onSelect: (selection: KnowledgeMapSelection) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: Error | null;
  onLoadMore: () => Promise<unknown>;
}) {
  const { collapsed: sidebarCollapsed } = useKnowledgeWorkspace();
  const layout = useMemo(
    () => buildKnowledgeMapLayout(pages, { anchorEntity }),
    [anchorEntity, pages],
  );
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(() => focusedKnowledgeMapViewBox(layout));
  const viewBoxRef = useRef(viewBox);
  const loadMorePending = useRef(false);
  const lastZoomLoadAt = useRef(0);
  const [panning, setPanning] = useState(false);
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
    () => knowledgeMapLayoutInViewport(layout, viewBox),
    [layout, viewBox],
  );
  const eagerImageKeys = useMemo(() => eagerKnowledgeMapImageKeys(visibleLayout), [visibleLayout]);
  const activeKey = preview ? previewKey(preview) : selectedKey;

  function updateViewBox(nextViewBox: ViewBox) {
    viewBoxRef.current = nextViewBox;
    setViewBox(nextViewBox);
  }

  async function requestLoadMore(viewport?: ViewBox) {
    if (
      !hasNextPage ||
      isFetchingNextPage ||
      loadMorePending.current ||
      (viewport && !mapViewportNearBoundary(viewport, layout.bounds))
    ) {
      return;
    }
    loadMorePending.current = true;
    try {
      await onLoadMore();
    } finally {
      loadMorePending.current = false;
    }
  }

  function zoom(factor: number, anchor = { x: 0.5, y: 0.5 }) {
    const current = viewBoxRef.current;
    const minimumWidth = layout.bounds.width * 0.28;
    const maximumWidth = layout.bounds.width * 2.5;
    const width = Math.min(maximumWidth, Math.max(minimumWidth, current.width * factor));
    const height = width * (current.height / current.width);
    const anchorX = current.x + current.width * anchor.x;
    const anchorY = current.y + current.height * anchor.y;
    const nextViewBox = {
      x: anchorX - width * anchor.x,
      y: anchorY - height * anchor.y,
      width,
      height,
    };
    updateViewBox(nextViewBox);
    const now = Date.now();
    if (
      factor > 1 &&
      mapViewportNearBoundary(nextViewBox, layout.bounds) &&
      now - lastZoomLoadAt.current >= ZOOM_LOAD_THROTTLE_MS
    ) {
      lastZoomLoadAt.current = now;
      void requestLoadMore(nextViewBox);
    }
  }

  function fitMap() {
    updateViewBox(layout.bounds);
    void requestLoadMore(layout.bounds);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const boundedDelta = Math.max(
      -MAX_WHEEL_ZOOM_DELTA,
      Math.min(MAX_WHEEL_ZOOM_DELTA, event.deltaY),
    );
    zoom(Math.exp(boundedDelta * WHEEL_ZOOM_RATE), {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('[data-map-resource]')) {
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
      Math.abs(event.clientX - drag.current.clientX) +
        Math.abs(event.clientY - drag.current.clientY) >
      4
    ) {
      drag.current.moved = true;
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
      const action = mapPointerEndAction({
        moved: completedDrag.moved,
        cloudReadableId: completedDrag.cloudReadableId,
        canLoadMore: hasNextPage && !isFetchingNextPage,
        nearBoundary: mapViewportNearBoundary(completedDrag.currentViewBox, layout.bounds),
      });
      suppressNextCloudClick.current = action.suppressCloudClick;
      if (action.selectedPageReadableId) {
        onSelect({ kind: 'page', readableId: action.selectedPageReadableId });
      }
      drag.current = null;
      setPanning(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (action.loadMore) {
        void requestLoadMore();
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

  const clearPreview = useCallback((key: string) => {
    setPreview((current) => (current && previewKey(current) === key ? null : current));
  }, []);

  return (
    <section
      className="relative size-full min-h-[28rem] overflow-hidden bg-card"
      aria-label={`Hypermedia map with ${visibleLayout.pages.length} visible knowledge pages and ${visibleLayout.resources.length} visible resource dots`}
    >
      <svg
        className={cn(
          'size-full touch-none select-none bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        aria-label="Interactive hypermedia map"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={fitMap}
      >
        <KnowledgeMapLayers
          layout={visibleLayout}
          activeKey={activeKey}
          eagerImageKeys={eagerImageKeys}
          suppressNextCloudClick={suppressNextCloudClick}
          onSelect={onSelect}
          onPreview={setPreview}
          onPreviewEnd={clearPreview}
        />
      </svg>

      {hasNextPage && !isFetchingNextPage && (
        <KnowledgeMapExplorationCue
          loadMoreError={loadMoreError}
          onLoadMore={() => void requestLoadMore()}
        />
      )}

      <div className="absolute bottom-4 left-4 flex flex-col gap-1 rounded-xl border bg-card/92 p-1 shadow-sm backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => zoom(BUTTON_ZOOM_IN_FACTOR)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => zoom(BUTTON_ZOOM_OUT_FACTOR)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fit hypermedia map"
          onClick={fitMap}
        >
          <Scan aria-hidden="true" />
        </Button>
      </div>

      {isFetchingNextPage && (
        <div
          className="absolute right-4 bottom-4 rounded-full border bg-card/92 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur"
          aria-live="polite"
        >
          Loading nearby knowledge…
        </div>
      )}

      {preview && previewKey(preview) !== selectedKey && (
        <div
          className={cn(
            'pointer-events-none absolute top-4 w-[min(20rem,calc(100%-2rem))] rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur',
            sidebarCollapsed && 'left-18 w-[min(20rem,calc(100%-7rem))]',
            !sidebarCollapsed && 'left-4',
          )}
          aria-live="polite"
        >
          <PreviewCard preview={preview} />
        </div>
      )}
    </section>
  );
}
