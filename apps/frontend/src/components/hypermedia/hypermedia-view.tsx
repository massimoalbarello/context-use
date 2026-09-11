import { FileText } from 'lucide-react';
import { type ComponentProps, type ReactNode, useCallback, useId, useMemo, useState } from 'react';
import { assetContentUrl, isEmbeddableAsset } from '../../lib/asset-presentation';
import { cn } from '../../lib/class-names';
import type {
  HypermediaAsset,
  HypermediaEntity,
  HypermediaPage,
  HypermediaResourceReference,
} from '../../queries/hypermedia';
import { AssetCardContent } from '../assets/asset-link';
import { EntityCardContent, entityInitial } from '../entities/entity-link';
import { useKnowledgeWorkspace } from '../knowledge/knowledge-workspace';
import { KnowledgePageCardContent } from '../pages/knowledge-page-link';
import {
  HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
  type HypermediaLayoutResource,
} from './hypermedia-layout';
import {
  type HypermediaSelection,
  hypermediaSelectionKey,
  selectedHypermediaResourceKeys,
} from './hypermedia-selection';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

const PAGE_LABEL_Y_OFFSET = 4;
const ACTIVE_CLOUD_FILL_OPACITY = 0.24;
const INACTIVE_CLOUD_FILL_OPACITY = 0.1;
const ACTIVE_CLOUD_STROKE_OPACITY = 0.9;
const INACTIVE_CLOUD_STROKE_OPACITY = 0.48;
const ACTIVE_CLOUD_STROKE_WIDTH = 3;
const INACTIVE_CLOUD_STROKE_WIDTH = 1.5;
const HYPERMEDIA_RESOURCE_NODE_RADIUS = 25;
const HYPERMEDIA_RESOURCE_LABEL_WIDTH = 120;
const HYPERMEDIA_RESOURCE_LABEL_HEIGHT = 42;
const HYPERMEDIA_RESOURCE_INITIAL_BASELINE_OFFSET = 6;
const HYPERMEDIA_RESOURCE_LABEL_MAX_CHARACTERS = 20;
const HYPERMEDIA_ASSET_NODE_CORNER_RADIUS = 10;
const HYPERMEDIA_RESOURCE_ICON_SIZE = 22;

function hypermediaResourceNodeEmphasis(active: boolean): {
  sizeOffset: number;
  strokeWidth: number;
} {
  return active ? { sizeOffset: 5, strokeWidth: 5 } : { sizeOffset: 1, strokeWidth: 2 };
}

type HypermediaResourceNodeFallback = HypermediaResourceReference & { label: string };
type HypermediaResourceNodeData = HypermediaLayoutResource | HypermediaResourceNodeFallback;
type HypermediaResourceNodeIdentity = {
  kind: HypermediaResourceReference['kind'];
  label: string;
  imageUrl?: string;
};

function hypermediaResourceNodeIdentity(
  resource: HypermediaResourceNodeData,
): HypermediaResourceNodeIdentity {
  if (resource.kind === 'entity') {
    return 'entity' in resource
      ? {
          kind: resource.kind,
          label: resource.entity.name,
          imageUrl: resource.entity.image
            ? assetContentUrl(resource.entity.image.readableId)
            : undefined,
        }
      : { kind: resource.kind, label: resource.label };
  }
  return 'asset' in resource
    ? {
        kind: resource.kind,
        label: resource.asset.name,
        imageUrl: isEmbeddableAsset(resource.asset)
          ? assetContentUrl(resource.asset.readableId)
          : undefined,
      }
    : { kind: resource.kind, label: resource.label };
}

function HypermediaResourceShape({
  kind,
  point,
  sizeOffset = 0,
  className,
  strokeWidth,
}: {
  kind: HypermediaResourceReference['kind'];
  point: { x: number; y: number };
  sizeOffset?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const radius = HYPERMEDIA_RESOURCE_NODE_RADIUS + sizeOffset;
  return kind === 'entity' ? (
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      className={className}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  ) : (
    <rect
      x={point.x - radius}
      y={point.y - radius}
      width={radius * 2}
      height={radius * 2}
      rx={HYPERMEDIA_ASSET_NODE_CORNER_RADIUS + sizeOffset}
      className={className}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function HypermediaResourceMark({
  identity,
  point,
  active,
}: {
  identity: HypermediaResourceNodeIdentity;
  point: { x: number; y: number };
  active: boolean;
}) {
  const clipPathId = `hypermedia-resource-${useId().replaceAll(':', '')}`;
  const emphasis = hypermediaResourceNodeEmphasis(active);
  const iconOffset = HYPERMEDIA_RESOURCE_ICON_SIZE / 2;
  return (
    <g data-hypermedia-resource-kind={identity.kind}>
      <HypermediaResourceShape
        kind={identity.kind}
        point={point}
        sizeOffset={emphasis.sizeOffset}
        className={cn(
          'fill-card stroke-border transition-[r,x,y,width,height,rx,stroke-width] motion-reduce:transition-none',
          active && 'stroke-foreground',
        )}
        strokeWidth={emphasis.strokeWidth}
      />
      <HypermediaResourceShape kind={identity.kind} point={point} className="fill-card" />
      {identity.kind === 'entity' ? (
        <text
          x={point.x}
          y={point.y + HYPERMEDIA_RESOURCE_INITIAL_BASELINE_OFFSET}
          textAnchor="middle"
          className="fill-foreground font-semibold text-lg uppercase"
        >
          {entityInitial(identity.label)}
        </text>
      ) : (
        <FileText
          x={point.x - iconOffset}
          y={point.y - iconOffset}
          width={HYPERMEDIA_RESOURCE_ICON_SIZE}
          height={HYPERMEDIA_RESOURCE_ICON_SIZE}
          className="text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      )}
      {identity.imageUrl && (
        <>
          <defs>
            <clipPath id={clipPathId}>
              <HypermediaResourceShape kind={identity.kind} point={point} />
            </clipPath>
          </defs>
          <image
            href={identity.imageUrl}
            x={point.x - HYPERMEDIA_RESOURCE_NODE_RADIUS}
            y={point.y - HYPERMEDIA_RESOURCE_NODE_RADIUS}
            width={HYPERMEDIA_RESOURCE_NODE_RADIUS * 2}
            height={HYPERMEDIA_RESOURCE_NODE_RADIUS * 2}
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
  | { kind: 'entity'; entity: HypermediaEntity }
  | { kind: 'asset'; asset: HypermediaAsset };

export type HypermediaViewProps = {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  selectedResources: HypermediaResourceReference[];
  selectedKey?: string;
  onSelect: (selection: HypermediaSelection) => void;
  onViewportSettled: (viewport: SettledHypermediaViewport) => void;
};

export function hypermediaPreviewKey(preview: HypermediaPreview): string {
  if (preview.kind === 'page') {
    return hypermediaSelectionKey({ kind: 'page', readableId: preview.page.readableId });
  }
  if (preview.kind === 'entity') {
    return hypermediaSelectionKey({ kind: 'entity', readableId: preview.entity.readableId });
  }
  return hypermediaSelectionKey({ kind: 'asset', readableId: preview.asset.readableId });
}

export function useHypermediaViewState({
  selectedResources,
  selectedKey,
}: Pick<HypermediaViewProps, 'selectedResources' | 'selectedKey'>) {
  const [preview, setPreview] = useState<HypermediaPreview | null>(null);
  const selectedResourceKeys = useMemo(
    () => selectedHypermediaResourceKeys(selectedResources),
    [selectedResources],
  );
  const activeKey = preview ? hypermediaPreviewKey(preview) : selectedKey;
  const clearPreview = useCallback((key: string) => {
    setPreview((current) => (current && hypermediaPreviewKey(current) === key ? null : current));
  }, []);

  return { activeKey, clearPreview, preview, selectedResourceKeys, setPreview };
}

export function shortHypermediaLabel({
  value,
  maximumCharacters = HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
}: {
  value: string;
  maximumCharacters?: number;
}): string {
  return value.length > maximumCharacters
    ? `${value.slice(0, maximumCharacters - 1).trimEnd()}…`
    : value;
}

export function HypermediaResourceNode({
  point,
  resource,
  active,
  labelWidth = HYPERMEDIA_RESOURCE_LABEL_WIDTH,
}: {
  point: { x: number; y: number };
  resource: HypermediaResourceNodeData;
  active: boolean;
  labelWidth?: number;
}) {
  const identity = hypermediaResourceNodeIdentity(resource);
  const displayLabel = shortHypermediaLabel({
    value: identity.label,
    maximumCharacters: HYPERMEDIA_RESOURCE_LABEL_MAX_CHARACTERS,
  });
  return (
    <g>
      <HypermediaResourceMark identity={identity} point={point} active={active} />
      <foreignObject
        x={point.x - labelWidth / 2}
        y={point.y + HYPERMEDIA_RESOURCE_NODE_RADIUS + 10}
        width={labelWidth}
        height={HYPERMEDIA_RESOURCE_LABEL_HEIGHT}
        className="pointer-events-none overflow-visible"
      >
        <div className="flex size-full justify-center whitespace-normal text-center font-medium text-[12px] text-foreground leading-[14px] [overflow-wrap:anywhere]">
          {displayLabel}
        </div>
      </foreignObject>
    </g>
  );
}

export function HypermediaPreviewCard({ preview }: { preview: HypermediaPreview }) {
  return (
    <div className="flex min-w-0 items-start gap-3 overflow-hidden">
      {preview.kind === 'page' ? (
        <KnowledgePageCardContent page={preview.page} />
      ) : preview.kind === 'entity' ? (
        <EntityCardContent entity={preview.entity} />
      ) : (
        <AssetCardContent asset={preview.asset} />
      )}
    </div>
  );
}

export function HypermediaHoverPreview({
  preview,
  selectedKey,
  className,
}: {
  preview: HypermediaPreview | null;
  selectedKey?: string;
  className: string;
}) {
  const { collapsed: sidebarCollapsed } = useKnowledgeWorkspace();
  if (!preview || hypermediaPreviewKey(preview) === selectedKey) {
    return null;
  }
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-40 w-[min(20rem,calc(100%-2rem))] overflow-hidden rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur',
        sidebarCollapsed && 'left-18 w-[min(20rem,calc(100%-7rem))]',
        !sidebarCollapsed && 'left-4',
        className,
      )}
      aria-live="polite"
    >
      <HypermediaPreviewCard preview={preview} />
    </div>
  );
}

type HypermediaPageLinkProps = Omit<
  ComponentProps<'a'>,
  | 'children'
  | 'href'
  | 'onBlur'
  | 'onClick'
  | 'onFocus'
  | 'onPointerEnter'
  | 'onPointerLeave'
  | 'onSelect'
> & {
  page: HypermediaPage;
  children: ReactNode;
  onSelect: (selection: HypermediaSelection) => void;
  onPreview?: (preview: HypermediaPreview) => void;
  onPreviewEnd?: (key: string) => void;
  shouldSelect?: () => boolean;
};

export function HypermediaPageLink({
  page,
  children,
  className,
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
        className,
      )}
      onPointerEnter={() => onPreview?.({ kind: 'page', page })}
      onPointerLeave={() => onPreviewEnd?.(key)}
      onFocus={() => onPreview?.({ kind: 'page', page })}
      onBlur={() => onPreviewEnd?.(key)}
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
  maximumCharacters = HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
}: {
  page: HypermediaPage;
  point: { x: number; y: number };
  active: boolean;
  maximumCharacters?: number;
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
      {shortHypermediaLabel({ value: page.title, maximumCharacters })}
    </text>
  );
}
