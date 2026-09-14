import { cn } from '@repo/ui/class-names';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import type { MapEntity, MapPage } from '../../queries/map';
import { EntityCardContent, entityInitial } from '../entities/entity-link';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { KnowledgePageCardContent } from '../pages/knowledge-page-link';
import { MAP_PAGE_LABEL_MAX_CHARACTERS, type MapLayoutEntity } from './map-layout';
import { type MapSelection, mapSelectionKey } from './map-selection';

const PAGE_LABEL_Y_OFFSET = 4;
const ACTIVE_CLOUD_FILL_OPACITY = 0.24;
const INACTIVE_CLOUD_FILL_OPACITY = 0.1;
const ACTIVE_CLOUD_STROKE_OPACITY = 0.9;
const INACTIVE_CLOUD_STROKE_OPACITY = 0.48;
const ACTIVE_CLOUD_STROKE_WIDTH = 3;
const INACTIVE_CLOUD_STROKE_WIDTH = 1.5;
const MAP_ENTITY_NODE_RADIUS = 25;
const MAP_ENTITY_LABEL_WIDTH = 120;
const MAP_ENTITY_LABEL_HEIGHT = 42;
const MAP_ENTITY_INITIAL_BASELINE_OFFSET = 6;
const MAP_ENTITY_LABEL_MAX_CHARACTERS = 20;

function mapEntityNodeEmphasis(active: boolean): {
  sizeOffset: number;
  strokeWidth: number;
} {
  return active ? { sizeOffset: 5, strokeWidth: 5 } : { sizeOffset: 1, strokeWidth: 2 };
}

type MapEntityNodeIdentity = {
  label: string;
  imageUrl?: string;
};

function mapEntityNodeIdentity(entity: MapLayoutEntity): MapEntityNodeIdentity {
  return {
    label: entity.entity.name,
    imageUrl: entity.entity.image ? assetContentUrl(entity.entity.image.readableId) : undefined,
  };
}

function MapEntityShape({
  point,
  sizeOffset = 0,
  className,
  strokeWidth,
}: {
  point: { x: number; y: number };
  sizeOffset?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const radius = MAP_ENTITY_NODE_RADIUS + sizeOffset;
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      className={className}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function MapEntityMark({
  identity,
  point,
  active,
}: {
  identity: MapEntityNodeIdentity;
  point: { x: number; y: number };
  active: boolean;
}) {
  const clipPathId = `map-entity-${useId().replaceAll(':', '')}`;
  const emphasis = mapEntityNodeEmphasis(active);
  return (
    <g data-map-entity-mark>
      <MapEntityShape
        point={point}
        sizeOffset={emphasis.sizeOffset}
        className={cn(
          'fill-card stroke-border transition-[r,x,y,width,height,rx,stroke-width] motion-reduce:transition-none',
          active && 'stroke-foreground',
        )}
        strokeWidth={emphasis.strokeWidth}
      />
      <MapEntityShape point={point} className="fill-card" />
      <text
        x={point.x}
        y={point.y + MAP_ENTITY_INITIAL_BASELINE_OFFSET}
        textAnchor="middle"
        className="fill-foreground font-semibold text-lg uppercase"
      >
        {entityInitial(identity.label)}
      </text>
      {identity.imageUrl && (
        <>
          <defs>
            <clipPath id={clipPathId}>
              <MapEntityShape point={point} />
            </clipPath>
          </defs>
          <image
            href={identity.imageUrl}
            x={point.x - MAP_ENTITY_NODE_RADIUS}
            y={point.y - MAP_ENTITY_NODE_RADIUS}
            width={MAP_ENTITY_NODE_RADIUS * 2}
            height={MAP_ENTITY_NODE_RADIUS * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipPathId})`}
          />
        </>
      )}
    </g>
  );
}

export type MapPreview = { kind: 'page'; page: MapPage } | { kind: 'entity'; entity: MapEntity };

export function mapPreviewKey(preview: MapPreview): string {
  if (preview.kind === 'page') {
    return mapSelectionKey({ kind: 'page', readableId: preview.page.readableId });
  }
  return mapSelectionKey({ kind: 'entity', readableId: preview.entity.readableId });
}

function shortMapLabel({
  value,
  maximumCharacters,
}: {
  value: string;
  maximumCharacters: number;
}): string {
  return value.length > maximumCharacters
    ? `${value.slice(0, maximumCharacters - 1).trimEnd()}…`
    : value;
}

export function MapEntityNode({ entity, active }: { entity: MapLayoutEntity; active: boolean }) {
  const { point } = entity;
  const identity = mapEntityNodeIdentity(entity);
  const displayLabel = shortMapLabel({
    value: identity.label,
    maximumCharacters: MAP_ENTITY_LABEL_MAX_CHARACTERS,
  });
  return (
    <g>
      <MapEntityMark identity={identity} point={point} active={active} />
      <foreignObject
        x={point.x - MAP_ENTITY_LABEL_WIDTH / 2}
        y={point.y + MAP_ENTITY_NODE_RADIUS + 10}
        width={MAP_ENTITY_LABEL_WIDTH}
        height={MAP_ENTITY_LABEL_HEIGHT}
        className="pointer-events-none overflow-visible"
      >
        <div className="flex size-full justify-center whitespace-normal text-center font-medium text-[12px] text-foreground leading-[14px] [overflow-wrap:anywhere]">
          {displayLabel}
        </div>
      </foreignObject>
    </g>
  );
}

function MapPreviewCard({ preview }: { preview: MapPreview }) {
  return (
    <div className="flex min-w-0 items-start gap-3 overflow-hidden">
      {preview.kind === 'page' ? (
        <KnowledgePageCardContent page={preview.page} />
      ) : (
        <EntityCardContent entity={preview.entity} />
      )}
    </div>
  );
}

export function MapHoverPreview({
  preview,
  selectedKey,
}: {
  preview: MapPreview | null;
  selectedKey?: string;
}) {
  const { collapsed: sidebarCollapsed } = useKnowledgeWorkspace();
  if (!preview || mapPreviewKey(preview) === selectedKey) {
    return null;
  }
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-4 z-40 w-[min(20rem,calc(100%-2rem))] overflow-hidden rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur',
        sidebarCollapsed && 'left-18 w-[min(20rem,calc(100%-7rem))]',
        !sidebarCollapsed && 'left-4',
      )}
      aria-live="polite"
    >
      <MapPreviewCard preview={preview} />
    </div>
  );
}

type MapPageLinkProps = Pick<ComponentProps<'a'>, 'aria-label' | 'tabIndex'> & {
  'data-map-cloud'?: string;
  'data-map-item'?: boolean;
  page: MapPage;
  children: ReactNode;
  onSelect: (selection: MapSelection) => void;
  onPreview: (preview: MapPreview) => void;
  onPreviewEnd: (key: string) => void;
  shouldSelect?: () => boolean;
};

export function MapPageLink({
  page,
  children,
  onSelect,
  onPreview,
  onPreviewEnd,
  shouldSelect,
  ...props
}: MapPageLinkProps) {
  const selection = { kind: 'page', readableId: page.readableId } as const;
  const key = mapSelectionKey(selection);
  return (
    <a
      {...props}
      href={`/pages/${encodeURIComponent(page.readableId)}?view=preview`}
      className={cn(
        'cursor-pointer outline-none',
        page.temporalCoverage !== null ? 'text-chart-1' : 'text-[oklch(0.81_0.1_145)]',
      )}
      onPointerEnter={() => onPreview({ kind: 'page', page })}
      onPointerLeave={() => onPreviewEnd(key)}
      onFocus={() => onPreview({ kind: 'page', page })}
      onBlur={() => onPreviewEnd(key)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (shouldSelect && !shouldSelect()) {
          return;
        }
        onSelect(selection);
      }}
    >
      {children}
    </a>
  );
}

export function MapPageCloud({ path, active }: { path: string; active: boolean }) {
  return (
    <path
      d={path}
      className="transition-[fill-opacity,stroke-opacity] duration-200 motion-reduce:transition-none"
      style={{
        fill: 'currentColor',
        fillOpacity: active ? ACTIVE_CLOUD_FILL_OPACITY : INACTIVE_CLOUD_FILL_OPACITY,
        stroke: 'currentColor',
        strokeOpacity: active ? ACTIVE_CLOUD_STROKE_OPACITY : INACTIVE_CLOUD_STROKE_OPACITY,
        strokeWidth: active ? ACTIVE_CLOUD_STROKE_WIDTH : INACTIVE_CLOUD_STROKE_WIDTH,
      }}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function MapPageLabel({
  page,
  point,
  active,
}: {
  page: MapPage;
  point: { x: number; y: number };
  active: boolean;
}) {
  return (
    <text
      x={point.x}
      y={point.y + PAGE_LABEL_Y_OFFSET}
      textAnchor="middle"
      className={`fill-foreground stroke-[7] stroke-card font-semibold text-[13px] [paint-order:stroke] [stroke-linejoin:round] ${
        active ? 'underline decoration-2 underline-offset-4' : ''
      }`}
    >
      {shortMapLabel({
        value: page.title,
        maximumCharacters: MAP_PAGE_LABEL_MAX_CHARACTERS,
      })}
    </text>
  );
}
