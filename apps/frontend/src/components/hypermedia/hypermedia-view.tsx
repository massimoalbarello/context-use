import { File } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/class-names';
import type {
  HypermediaAsset,
  HypermediaEntity,
  HypermediaPage,
  HypermediaResourceReference,
} from '../../queries/hypermedia';
import { AssetCardContent } from '../assets/asset-link';
import { EntityCardContent, entityInitial } from '../entities/entity-link';
import { KnowledgePageCardContent } from '../pages/knowledge-page-link';
import {
  HYPERMEDIA_PAGE_LABEL_MAX_CHARACTERS,
  type HypermediaLayoutResource,
} from './hypermedia-layout';
import { type HypermediaSelection, hypermediaSelectionKey } from './hypermedia-selection';
import type { SettledHypermediaViewport } from './hypermedia-visibility';

const PAGE_LABEL_Y_OFFSET = 4;
const ACTIVE_CLOUD_FILL_OPACITY = 0.24;
const INACTIVE_CLOUD_FILL_OPACITY = 0.1;
const ACTIVE_CLOUD_STROKE_OPACITY = 0.9;
const INACTIVE_CLOUD_STROKE_OPACITY = 0.48;
const ACTIVE_CLOUD_STROKE_WIDTH = 3;
const INACTIVE_CLOUD_STROKE_WIDTH = 1.5;

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
  sidebarCollapsed,
  position,
}: {
  preview: HypermediaPreview | null;
  selectedKey?: string;
  sidebarCollapsed: boolean;
  position: 'canvas-top' | 'below-resource-headers';
}) {
  if (!preview || hypermediaPreviewKey(preview) === selectedKey) {
    return null;
  }
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-40 w-[min(20rem,calc(100%-2rem))] overflow-hidden rounded-2xl border bg-card/95 p-4 shadow-lg backdrop-blur',
        position === 'canvas-top' && 'top-4',
        position === 'below-resource-headers' && 'top-28',
        sidebarCollapsed && 'left-18 w-[min(20rem,calc(100%-7rem))]',
        !sidebarCollapsed && 'left-4',
      )}
      aria-live="polite"
    >
      <HypermediaPreviewCard preview={preview} />
    </div>
  );
}

export function HypermediaResourceCardContent({
  resource,
  reference,
  fallbackLabel,
}: {
  resource?: HypermediaLayoutResource;
  reference: HypermediaResourceReference;
  fallbackLabel: string;
}) {
  if (resource?.kind === 'entity') {
    return <EntityCardContent entity={resource.entity} />;
  }
  if (resource?.kind === 'asset') {
    return <AssetCardContent asset={resource.asset} />;
  }
  return (
    <>
      <span
        className={`flex size-9 shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground ${
          reference.kind === 'entity' ? 'rounded-full' : 'rounded-md'
        }`}
        aria-hidden="true"
      >
        {reference.kind === 'entity' ? (
          <span className="font-semibold text-xs uppercase">{entityInitial(fallbackLabel)}</span>
        ) : (
          <File className="size-5 stroke-[1.4]" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5 text-left">
        <strong className="truncate font-semibold text-sm">{fallbackLabel}</strong>
        <small className="truncate text-muted-foreground text-xs">
          {reference.kind === 'entity' ? 'Entity' : 'Asset'}
        </small>
      </span>
    </>
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
      className={`cursor-pointer outline-none ${className ?? ''}`}
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

export function HypermediaPageCloud({
  path,
  colorIndex,
  active,
}: {
  path: string;
  colorIndex: number;
  active: boolean;
}) {
  return (
    <path
      d={path}
      className="transition-[fill-opacity,stroke-opacity] duration-200 motion-reduce:transition-none"
      style={{
        color: `var(--chart-${colorIndex})`,
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
