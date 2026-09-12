import { type ComponentProps, type ReactNode, useId } from 'react';
import { assetContentUrl } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type { HypermediaEntity, HypermediaPage } from '../../queries/hypermedia';
import { EntityCardContent, entityInitial } from '../entities/entity-link';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { KnowledgePageCardContent } from '../pages/knowledge-page-link';
import {
  HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
  type HypermediaLayoutEntity,
} from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';

const PAGE_LABEL_Y_OFFSET = 4;
const ACTIVE_CLOUD_FILL_OPACITY = 0.24;
const INACTIVE_CLOUD_FILL_OPACITY = 0.1;
const ACTIVE_CLOUD_STROKE_OPACITY = 0.9;
const INACTIVE_CLOUD_STROKE_OPACITY = 0.48;
const ACTIVE_CLOUD_STROKE_WIDTH = 3;
const INACTIVE_CLOUD_STROKE_WIDTH = 1.5;
const HYPERMEDIA_ENTITY_NODE_RADIUS = 25;
const HYPERMEDIA_ENTITY_LABEL_WIDTH = 120;
const HYPERMEDIA_ENTITY_LABEL_HEIGHT = 42;
const HYPERMEDIA_ENTITY_INITIAL_BASELINE_OFFSET = 6;
const HYPERMEDIA_ENTITY_LABEL_MAX_CHARACTERS = 20;

function hypermediaEntityNodeEmphasis(active: boolean): {
  sizeOffset: number;
  strokeWidth: number;
} {
  return active ? { sizeOffset: 5, strokeWidth: 5 } : { sizeOffset: 1, strokeWidth: 2 };
}

type HypermediaEntityNodeIdentity = {
  label: string;
  imageUrl?: string;
};

function hypermediaEntityNodeIdentity(
  entity: HypermediaLayoutEntity,
): HypermediaEntityNodeIdentity {
  return {
    label: entity.entity.name,
    imageUrl: entity.entity.image ? assetContentUrl(entity.entity.image.readableId) : undefined,
  };
}

function HypermediaEntityShape({
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
  const radius = HYPERMEDIA_ENTITY_NODE_RADIUS + sizeOffset;
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

function HypermediaEntityMark({
  identity,
  point,
  active,
}: {
  identity: HypermediaEntityNodeIdentity;
  point: { x: number; y: number };
  active: boolean;
}) {
  const clipPathId = `hypermedia-entity-${useId().replaceAll(':', '')}`;
  const emphasis = hypermediaEntityNodeEmphasis(active);
  return (
    <g data-hypermedia-entity-mark>
      <HypermediaEntityShape
        point={point}
        sizeOffset={emphasis.sizeOffset}
        className={cn(
          'fill-card stroke-border transition-[r,x,y,width,height,rx,stroke-width] motion-reduce:transition-none',
          active && 'stroke-foreground',
        )}
        strokeWidth={emphasis.strokeWidth}
      />
      <HypermediaEntityShape point={point} className="fill-card" />
      <text
        x={point.x}
        y={point.y + HYPERMEDIA_ENTITY_INITIAL_BASELINE_OFFSET}
        textAnchor="middle"
        className="fill-foreground font-semibold text-lg uppercase"
      >
        {entityInitial(identity.label)}
      </text>
      {identity.imageUrl && (
        <>
          <defs>
            <clipPath id={clipPathId}>
              <HypermediaEntityShape point={point} />
            </clipPath>
          </defs>
          <image
            href={identity.imageUrl}
            x={point.x - HYPERMEDIA_ENTITY_NODE_RADIUS}
            y={point.y - HYPERMEDIA_ENTITY_NODE_RADIUS}
            width={HYPERMEDIA_ENTITY_NODE_RADIUS * 2}
            height={HYPERMEDIA_ENTITY_NODE_RADIUS * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipPathId})`}
          />
        </>
      )}
    </g>
  );
}

export type HypermediaPreview =
  | { kind: 'page'; page: HypermediaPage }
  | { kind: 'entity'; entity: HypermediaEntity };

export function hypermediaPreviewKey(preview: HypermediaPreview): string {
  if (preview.kind === 'page') {
    return hypermediaSelectionKey({ kind: 'page', readableId: preview.page.readableId });
  }
  return hypermediaSelectionKey({ kind: 'entity', readableId: preview.entity.readableId });
}

function shortHypermediaLabel({
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

export function HypermediaEntityNode({
  entity,
  active,
}: {
  entity: HypermediaLayoutEntity;
  active: boolean;
}) {
  const { point } = entity;
  const identity = hypermediaEntityNodeIdentity(entity);
  const displayLabel = shortHypermediaLabel({
    value: identity.label,
    maximumCharacters: HYPERMEDIA_ENTITY_LABEL_MAX_CHARACTERS,
  });
  return (
    <g>
      <HypermediaEntityMark identity={identity} point={point} active={active} />
      <foreignObject
        x={point.x - HYPERMEDIA_ENTITY_LABEL_WIDTH / 2}
        y={point.y + HYPERMEDIA_ENTITY_NODE_RADIUS + 10}
        width={HYPERMEDIA_ENTITY_LABEL_WIDTH}
        height={HYPERMEDIA_ENTITY_LABEL_HEIGHT}
        className="pointer-events-none overflow-visible"
      >
        <div className="flex size-full justify-center whitespace-normal text-center font-medium text-[12px] text-foreground leading-[14px] [overflow-wrap:anywhere]">
          {displayLabel}
        </div>
      </foreignObject>
    </g>
  );
}

function HypermediaPreviewCard({ preview }: { preview: HypermediaPreview }) {
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

export function HypermediaHoverPreview({
  preview,
  selectedKey,
}: {
  preview: HypermediaPreview | null;
  selectedKey?: string;
}) {
  const { collapsed: sidebarCollapsed } = useKnowledgeWorkspace();
  if (!preview || hypermediaPreviewKey(preview) === selectedKey) {
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
      <HypermediaPreviewCard preview={preview} />
    </div>
  );
}

type HypermediaPageLinkProps = Pick<ComponentProps<'a'>, 'aria-label' | 'tabIndex'> & {
  'data-hypermedia-cloud'?: string;
  'data-hypermedia-item'?: boolean;
  page: HypermediaPage;
  children: ReactNode;
  onSelect: (selection: HypermediaSelection) => void;
  onPreview: (preview: HypermediaPreview) => void;
  onPreviewEnd: (key: string) => void;
  shouldSelect?: () => boolean;
};

export function HypermediaPageLink({
  page,
  children,
  onSelect,
  onPreview,
  onPreviewEnd,
  shouldSelect,
  ...props
}: HypermediaPageLinkProps) {
  const selection = { kind: 'page', readableId: page.readableId } as const;
  const key = hypermediaSelectionKey(selection);
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

export function HypermediaPageCloud({ path, active }: { path: string; active: boolean }) {
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

export function HypermediaPageLabel({
  page,
  point,
  active,
}: {
  page: HypermediaPage;
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
      {shortHypermediaLabel({
        value: page.title,
        maximumCharacters: HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
      })}
    </text>
  );
}
