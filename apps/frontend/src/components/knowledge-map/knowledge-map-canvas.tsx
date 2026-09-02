// biome-ignore-all lint/complexity/useMaxParams: Canvas geometry uses coordinate pairs and pointer anchors.
// biome-ignore-all lint/style/noMagicNumbers: SVG drawing and zoom constants intentionally define the visual geometry.
import { useNavigate } from '@tanstack/react-router';
import { File, FileText, Minus, Plus, Scan, Waypoints } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useRef, useState, type WheelEvent } from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type {
  KnowledgeMapAsset,
  KnowledgeMapEntity,
  KnowledgeMapPage,
} from '../../queries/knowledge-map';
import { formatAssetSize } from '../assets/asset-link';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  buildKnowledgeMapLayout,
  type KnowledgeMapResource,
  type MapPoint,
} from './knowledge-map-layout';

type MapPreview =
  | { kind: 'page'; page: KnowledgeMapPage }
  | { kind: 'entity'; entity: KnowledgeMapEntity }
  | { kind: 'asset'; asset: KnowledgeMapAsset };

type ViewBox = { x: number; y: number; width: number; height: number };

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

function pageReferencePath(source: MapPoint, target: MapPoint): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const curve = Math.min(80, Math.hypot(dx, dy) * 0.18);
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = (-dy / length) * curve;
  const normalY = (dx / length) * curve;
  const midpointX = (source.x + target.x) / 2 + normalX;
  const midpointY = (source.y + target.y) / 2 + normalY;
  return `M ${source.x} ${source.y} Q ${midpointX.toFixed(1)} ${midpointY.toFixed(1)} ${target.x} ${target.y}`;
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
            <Badge variant="secondary">Page cloud</Badge>
            <h2 className="mt-1 truncate font-semibold text-base">{page.title}</h2>
          </div>
        </div>
        <p className="line-clamp-3 text-muted-foreground text-sm leading-relaxed">
          {page.excerpt || 'This page has no excerpt.'}
        </p>
        <div className="flex flex-wrap gap-2 text-muted-foreground text-xs">
          <span>{page.mentions.length} entities</span>
          <span aria-hidden="true">·</span>
          <span>{page.assetUsages.length} assets</span>
          <span aria-hidden="true">·</span>
          <span>{page.references.length} page references</span>
          {page.temporalCoverage && (
            <>
              <span aria-hidden="true">·</span>
              <span>{page.temporalCoverage}</span>
            </>
          )}
        </div>
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
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
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

function ResourceDot({
  resource,
  active,
  onActivate,
  onPreview,
  onPreviewEnd,
}: {
  resource: KnowledgeMapResource;
  active: boolean;
  onActivate: () => void;
  onPreview: () => void;
  onPreviewEnd: () => void;
}) {
  const radius = resource.kind === 'entity' ? 25 : 22;
  const imageReadableId =
    resource.kind === 'entity'
      ? resource.entity.image?.readableId
      : isEmbeddableAsset(resource.asset)
        ? resource.asset.readableId
        : undefined;
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
          <circle cx={resource.point.x} cy={resource.point.y} r={radius - 3} />
        </clipPath>
      </defs>
      <circle
        cx={resource.point.x}
        cy={resource.point.y}
        r={radius + (active ? 5 : 1)}
        className={cn(
          'fill-card stroke-[2] stroke-border transition-[r,stroke-width] motion-reduce:transition-none',
          active && 'stroke-[3] stroke-foreground',
        )}
      />
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
      <text
        x={resource.point.x}
        y={resource.point.y + radius + 32}
        textAnchor="middle"
        className="pointer-events-none fill-muted-foreground font-mono text-[9px] uppercase tracking-[0.14em]"
      >
        {resource.kind}
      </text>
    </a>
  );
}

export function KnowledgeMapCanvas({ pages }: { pages: KnowledgeMapPage[] }) {
  const navigate = useNavigate();
  const layout = buildKnowledgeMapLayout(pages);
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(layout.bounds);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewBox: ViewBox;
  } | null>(null);
  const activeKey = preview ? previewKey(preview) : undefined;

  function zoom(factor: number, anchor = { x: 0.5, y: 0.5 }) {
    setViewBox((current) => {
      const minimumWidth = layout.bounds.width * 0.28;
      const maximumWidth = layout.bounds.width * 2.5;
      const width = Math.min(maximumWidth, Math.max(minimumWidth, current.width * factor));
      const height = width * (current.height / current.width);
      const anchorX = current.x + current.width * anchor.x;
      const anchorY = current.y + current.height * anchor.y;
      return {
        x: anchorX - width * anchor.x,
        y: anchorY - height * anchor.y,
        width,
        height,
      };
    });
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoom(event.deltaY > 0 ? 1.12 : 0.89, {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('[data-map-resource]')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewBox,
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
    setViewBox({
      ...drag.current.viewBox,
      x: drag.current.viewBox.x - dx,
      y: drag.current.viewBox.y - dy,
    });
  }

  function handlePointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setPanning(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clearPreview(key: string) {
    setPreview((current) => (current && previewKey(current) === key ? null : current));
  }

  return (
    <section
      className="relative size-full min-h-[28rem] overflow-hidden bg-card"
      aria-label={`Knowledge map with ${layout.pages.length} page clouds and ${layout.resources.length} resource dots`}
    >
      <svg
        className={cn(
          'size-full touch-none select-none bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:22px_22px]',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={() => setViewBox(layout.bounds)}
      >
        <title>Interactive knowledge map</title>
        <defs>
          <marker
            id="map-reference-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
          <filter id="map-label-shadow" x="-30%" y="-50%" width="160%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
          </filter>
        </defs>

        {layout.pages.map((item) => {
          const key = `page:${item.page.readableId}`;
          const active = activeKey === key;
          return (
            <path
              key={item.page.readableId}
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
              onPointerEnter={() => setPreview({ kind: 'page', page: item.page })}
              onPointerLeave={() => clearPreview(key)}
            />
          );
        })}

        {layout.references.map((reference) => (
          <path
            key={reference.key}
            d={pageReferencePath(reference.source, reference.target)}
            className="fill-none stroke-[1.5] stroke-muted-foreground/65 [stroke-dasharray:6_7]"
            markerEnd="url(#map-reference-arrow)"
          />
        ))}

        {layout.pages.map((item) =>
          item.words.map((word, index) => {
            const angle = (index / Math.max(item.words.length, 1)) * Math.PI * 2 - Math.PI / 2;
            return (
              <text
                key={`${item.page.readableId}:${word}`}
                x={item.point.x + Math.cos(angle) * 86}
                y={item.point.y + Math.sin(angle) * 62}
                textAnchor="middle"
                className="pointer-events-none fill-foreground/35 font-medium text-[12px]"
              >
                {shortLabel(word, 18)}
              </text>
            );
          }),
        )}

        {layout.pages.map((item) => {
          const key = `page:${item.page.readableId}`;
          const active = activeKey === key;
          return (
            <a
              key={item.page.readableId}
              href={`/pages/${encodeURIComponent(item.page.readableId)}?view=preview`}
              data-map-resource
              aria-label={`Open page ${item.page.title}`}
              className="cursor-pointer outline-none"
              onPointerEnter={() => setPreview({ kind: 'page', page: item.page })}
              onPointerLeave={() => clearPreview(key)}
              onFocus={() => setPreview({ kind: 'page', page: item.page })}
              onBlur={() => clearPreview(key)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void navigate({
                  to: '/pages/$id',
                  params: { id: item.page.readableId },
                  search: { view: 'preview' },
                });
              }}
            >
              <rect
                x={item.point.x - 84}
                y={item.point.y - 25}
                width="168"
                height="50"
                rx="18"
                className={cn(
                  'fill-card stroke-[1.5] stroke-border transition-[stroke-width] motion-reduce:transition-none',
                  active && 'stroke-[2.5] stroke-foreground',
                )}
                filter="url(#map-label-shadow)"
              />
              <g
                transform={`translate(${item.point.x - 67} ${item.point.y - 10})`}
                className="fill-none stroke-[1.6] stroke-muted-foreground"
              >
                <path d="M1 0h10l5 5v15H1z" />
                <path d="M11 0v5h5" />
              </g>
              <text
                x={item.point.x - 43}
                y={item.point.y + 2}
                className="fill-foreground font-semibold text-[12px]"
              >
                {shortLabel(item.page.title, 20)}
              </text>
              <text
                x={item.point.x - 43}
                y={item.point.y + 16}
                className="fill-muted-foreground font-mono text-[8px] uppercase tracking-[0.13em]"
              >
                page cloud
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
              onPreview={() => setPreview(preview)}
              onPreviewEnd={() => clearPreview(resource.key)}
              onActivate={() => {
                if (resource.kind === 'entity') {
                  void navigate({
                    to: '/entities/$id',
                    params: { id: resource.entity.readableId },
                  });
                } else {
                  void navigate({
                    to: '/assets/$id',
                    params: { id: resource.asset.readableId },
                  });
                }
              }}
            />
          );
        })}
      </svg>

      <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2 rounded-xl border bg-card/90 px-3 py-2 shadow-sm backdrop-blur">
        <Waypoints className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-sm">Drag to move · scroll to zoom</span>
      </div>

      <div className="absolute right-4 bottom-4 flex flex-col gap-1 rounded-xl border bg-card/92 p-1 shadow-sm backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => zoom(0.82)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => zoom(1.2)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fit knowledge map"
          onClick={() => setViewBox(layout.bounds)}
        >
          <Scan aria-hidden="true" />
        </Button>
      </div>

      {preview && (
        <div
          className="pointer-events-none absolute bottom-4 left-4 w-[min(22rem,calc(100%-6rem))] rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur"
          aria-live="polite"
        >
          <PreviewCard preview={preview} />
          <p className="mt-3 text-[0.68rem] text-muted-foreground uppercase tracking-[0.12em]">
            Select to open
          </p>
        </div>
      )}
    </section>
  );
}
