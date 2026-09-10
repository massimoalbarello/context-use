// biome-ignore-all lint/style/noMagicNumbers: Temporal canvas geometry is expressed by visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Collection callbacks and geometry helpers are locally scoped.

import { parseTemporalCoverage } from '@repo/backend/temporal-coverage';
import {
  type CalendarDateRange,
  epochDayFromCalendarDate,
  temporalCoverageExpression,
} from '../../lib/temporal-coverage';
import type {
  HypermediaPage,
  HypermediaPages,
  HypermediaResourceReference,
} from '../../queries/hypermedia';
import { hypermediaResourceKey } from '../../queries/hypermedia';
import {
  type HypermediaLayoutResource,
  hypermediaLayoutResourceLabel,
  hypermediaLayoutResourceReference,
  hypermediaPageColorIndex,
  hypermediaPagePlacementRatio,
} from './hypermedia-layout';

const MILLISECONDS_PER_DAY = 86_400_000;
const MINIMUM_CANVAS_WIDTH = 1_200;
const MINIMUM_TIMELINE_HEIGHT = 7_200;
const MAXIMUM_TIMELINE_HEIGHT = 24_000;
const PIXELS_PER_DAY = 1.25;
const RESOURCE_COLUMN_START_X = 80;
const RESOURCE_COLUMN_SPACING = 72;
const RESOURCE_RIGHT_PADDING = 64;
const TIMELINE_START_Y = 144;
const TIMELINE_BOTTOM_PADDING = 120;
const PAGE_RESOURCE_PADDING = 52;
const PAGE_HEIGHT = 32;
const PAGE_GAP = 6;
const MINIMUM_PAGE_WIDTH = 160;
const DISTRIBUTED_INTERVAL_MINIMUM_DURATION = MILLISECONDS_PER_DAY * 4;
const DISTRIBUTED_INTERVAL_EDGE_RATIO = 0.12;

type TemporalExtent = NonNullable<HypermediaPages['temporalExtent']>;
type Bounds = { left: number; right: number; top: number; bottom: number };

export type TemporalHypermediaResource = HypermediaResourceReference & {
  key: string;
  label: string;
  x: number;
  resource?: HypermediaLayoutResource;
};

export type TemporalHypermediaPage = {
  page: HypermediaPage;
  resourceKeys: string[];
  path: string;
  label: { x: number; y: number };
  bounds: Bounds;
  colorIndex: number;
};

export type TemporalHypermediaTick = {
  y: number;
  time: number;
};

export type TemporalHypermediaLayout = {
  width: number;
  height: number;
  timelineStartY: number;
  timelineEndY: number;
  pageLoadBoundaryY: number | null;
  hasOverlappingPages: boolean;
  extent: TemporalExtent;
  resources: TemporalHypermediaResource[];
  pages: TemporalHypermediaPage[];
  ticks: TemporalHypermediaTick[];
};

type TemporalPageCandidate = {
  page: HypermediaPage;
  resourceKeys: string[];
  left: number;
  right: number;
  minimumY: number;
  maximumY: number;
  preferredY: number;
  colorIndex: number;
  duration: number;
};

function fallbackResourceLabel(reference: HypermediaResourceReference): string {
  return reference.readableId
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function timelineHeight(extent: TemporalExtent): number {
  const days = Math.max(1, (extent.end - extent.start) / MILLISECONDS_PER_DAY);
  return Math.min(
    MAXIMUM_TIMELINE_HEIGHT,
    Math.max(
      MINIMUM_TIMELINE_HEIGHT,
      days * PIXELS_PER_DAY + TIMELINE_START_Y + TIMELINE_BOTTOM_PADDING,
    ),
  );
}

function canvasWidth(resourceCount: number): number {
  const lastResourceX =
    RESOURCE_COLUMN_START_X + Math.max(0, resourceCount - 1) * RESOURCE_COLUMN_SPACING;
  return Math.max(MINIMUM_CANVAS_WIDTH, lastResourceX + RESOURCE_RIGHT_PADDING);
}

function timeY({
  time,
  extent,
  startY,
  endY,
}: {
  time: number;
  extent: TemporalExtent;
  startY: number;
  endY: number;
}): number {
  if (extent.start === extent.end) {
    return (startY + endY) / 2;
  }
  const progress =
    (extent.end - clamp(time, extent.start, extent.end)) / (extent.end - extent.start);
  return startY + progress * (endY - startY);
}

function capsulePath({ left, right, top, bottom }: Bounds): string {
  const radius = (bottom - top) / 2;
  const centerY = top + radius;
  return [
    `M ${left + radius} ${top}`,
    `H ${right - radius}`,
    `A ${radius} ${radius} 0 0 1 ${right} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
    `H ${left + radius}`,
    `A ${radius} ${radius} 0 0 1 ${left} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${left + radius} ${top}`,
    'Z',
  ].join(' ');
}

function resourceColumns({
  resources,
  pages,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
}): TemporalHypermediaResource[] {
  const columns = new Map<string, Omit<TemporalHypermediaResource, 'x'>>();
  for (const resource of resources) {
    const reference = hypermediaLayoutResourceReference(resource);
    columns.set(resource.key, {
      key: resource.key,
      ...reference,
      label: hypermediaLayoutResourceLabel(resource),
      resource,
    });
  }
  for (const reference of pages.flatMap(({ resources: references }) => references)) {
    const key = hypermediaResourceKey(reference);
    if (!columns.has(key)) {
      columns.set(key, { ...reference, key, label: fallbackResourceLabel(reference) });
    }
  }
  return [...columns.values()].map((column, index) => ({
    ...column,
    x: RESOURCE_COLUMN_START_X + index * RESOURCE_COLUMN_SPACING,
  }));
}

function pageBounds({
  candidate,
  centerY,
}: {
  candidate: TemporalPageCandidate;
  centerY: number;
}): Bounds {
  return {
    left: candidate.left,
    right: candidate.right,
    top: centerY - PAGE_HEIGHT / 2,
    bottom: centerY + PAGE_HEIGHT / 2,
  };
}

function pageBoundsOverlap(first: Bounds, second: Bounds): boolean {
  return (
    first.left < second.right + PAGE_GAP &&
    first.right + PAGE_GAP > second.left &&
    first.top < second.bottom + PAGE_GAP &&
    first.bottom + PAGE_GAP > second.top
  );
}

function pageBoundsOverlapHorizontally(first: Bounds, second: Bounds): boolean {
  return first.left < second.right + PAGE_GAP && first.right + PAGE_GAP > second.left;
}

function pageCenterCandidates({
  candidate,
  occupiedPageBounds,
  currentCenter,
}: {
  candidate: TemporalPageCandidate;
  occupiedPageBounds: Bounds[];
  currentCenter?: number;
}): number[] {
  const candidateBounds = pageBounds({ candidate, centerY: candidate.preferredY });
  const possibleCenters = [
    candidate.preferredY,
    candidate.minimumY,
    candidate.maximumY,
    ...(currentCenter === undefined ? [] : [currentCenter]),
  ];
  for (const occupied of occupiedPageBounds) {
    if (!pageBoundsOverlapHorizontally(candidateBounds, occupied)) {
      continue;
    }
    possibleCenters.push(
      occupied.top - PAGE_HEIGHT / 2 - PAGE_GAP,
      occupied.top - PAGE_HEIGHT / 2,
      occupied.bottom + PAGE_HEIGHT / 2,
      occupied.bottom + PAGE_HEIGHT / 2 + PAGE_GAP,
    );
  }
  return [...new Set(possibleCenters)].filter(
    (centerY) => centerY >= candidate.minimumY && centerY <= candidate.maximumY,
  );
}

function pageOverlapArea(first: Bounds, second: Bounds): number {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  return width * height;
}

function pageOverlapScore(bounds: Bounds, occupiedPageBounds: Bounds[]): number {
  return occupiedPageBounds.reduce(
    (total, occupied) => total + pageOverlapArea(bounds, occupied),
    0,
  );
}

function hasOverlappingPages(pages: TemporalHypermediaPage[]): boolean {
  for (const [index, page] of pages.entries()) {
    for (const other of pages.slice(index + 1)) {
      if (pageOverlapArea(page.bounds, other.bounds) > 0) {
        return true;
      }
    }
  }
  return false;
}

function openPageCenter({
  candidate,
  occupiedPageBounds,
  possibleCenters,
}: {
  candidate: TemporalPageCandidate;
  occupiedPageBounds: Bounds[];
  possibleCenters: number[];
}): number {
  const available = possibleCenters.find((centerY) => {
    const bounds = pageBounds({ candidate, centerY });
    return !occupiedPageBounds.some((occupied) => pageBoundsOverlap(bounds, occupied));
  });
  if (available !== undefined) {
    return available;
  }
  return possibleCenters.reduce((best, centerY) => {
    const overlap = pageOverlapScore(pageBounds({ candidate, centerY }), occupiedPageBounds);
    const bestOverlap = pageOverlapScore(
      pageBounds({ candidate, centerY: best }),
      occupiedPageBounds,
    );
    return overlap < bestOverlap ? centerY : best;
  });
}

function earliestOpenPageCenter({
  candidate,
  occupiedPageBounds,
}: {
  candidate: TemporalPageCandidate;
  occupiedPageBounds: Bounds[];
}): number {
  const possibleCenters = pageCenterCandidates({ candidate, occupiedPageBounds }).sort(
    (first, second) => first - second,
  );
  return openPageCenter({ candidate, occupiedPageBounds, possibleCenters });
}

function preferredOpenPageCenter({
  candidate,
  currentCenter,
  occupiedPageBounds,
}: {
  candidate: TemporalPageCandidate;
  currentCenter: number;
  occupiedPageBounds: Bounds[];
}): number {
  const possibleCenters = pageCenterCandidates({
    candidate,
    currentCenter,
    occupiedPageBounds,
  }).sort(
    (first, second) =>
      Math.abs(first - candidate.preferredY) - Math.abs(second - candidate.preferredY) ||
      first - second,
  );
  return openPageCenter({ candidate, occupiedPageBounds, possibleCenters });
}

export function buildTemporalHypermediaLayout({
  resources,
  pages,
  extent,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
  extent: TemporalExtent;
}): TemporalHypermediaLayout {
  const temporalPages = pages.filter(({ temporalCoverage }) => temporalCoverage !== null);
  const columns = resourceColumns({ resources, pages: temporalPages });
  const width = canvasWidth(columns.length);
  const baseHeight = timelineHeight(extent);
  const timelineEndY = baseHeight - TIMELINE_BOTTOM_PADDING;
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const candidates = temporalPages.flatMap((page): TemporalPageCandidate[] => {
    if (!page.temporalCoverage) {
      return [];
    }
    const coverage = parseTemporalCoverage(temporalCoverageExpression(page.temporalCoverage));
    const start = clamp(coverage.bounds.start, extent.start, extent.end);
    const inclusiveEnd = coverage.bounds.end
      ? coverage.bounds.end - MILLISECONDS_PER_DAY
      : extent.end;
    const end = clamp(Math.max(start, inclusiveEnd), extent.start, extent.end);
    const resourceKeys = [...new Set(page.resources.map(hypermediaResourceKey))];
    const connectedColumns = resourceKeys.flatMap((resourceKey) => {
      const column = columnByKey.get(resourceKey);
      return column ? [column] : [];
    });
    if (connectedColumns.length === 0) {
      return [];
    }
    const minimumX = Math.min(...connectedColumns.map(({ x }) => x));
    const maximumX = Math.max(...connectedColumns.map(({ x }) => x));
    const centerX = (minimumX + maximumX) / 2;
    const left = Math.min(minimumX - PAGE_RESOURCE_PADDING, centerX - MINIMUM_PAGE_WIDTH / 2);
    const right = Math.max(maximumX + PAGE_RESOURCE_PADDING, centerX + MINIMUM_PAGE_WIDTH / 2);
    const recentY = timeY({
      time: end,
      extent,
      startY: TIMELINE_START_Y,
      endY: timelineEndY,
    });
    const olderY = timeY({
      time: start,
      extent,
      startY: TIMELINE_START_Y,
      endY: timelineEndY,
    });
    const minimumY = Math.max(TIMELINE_START_Y + PAGE_HEIGHT / 2, recentY);
    const maximumY = Math.max(minimumY, olderY);
    const placementRatio =
      DISTRIBUTED_INTERVAL_EDGE_RATIO +
      hypermediaPagePlacementRatio(page.readableId) * (1 - DISTRIBUTED_INTERVAL_EDGE_RATIO * 2);
    const preferredY =
      end - start >= DISTRIBUTED_INTERVAL_MINIMUM_DURATION
        ? minimumY + (maximumY - minimumY) * placementRatio
        : minimumY;
    return [
      {
        page,
        resourceKeys,
        left,
        right,
        minimumY,
        maximumY,
        preferredY,
        colorIndex: hypermediaPageColorIndex(page.readableId),
        duration: end - start,
      },
    ];
  });
  candidates.sort(
    (first, second) =>
      first.maximumY - second.maximumY ||
      first.minimumY - second.minimumY ||
      first.duration - second.duration ||
      first.page.readableId.localeCompare(second.page.readableId),
  );

  // Establish a collision-free baseline first, then move each page toward its stable preferred
  // date without sacrificing a slot that already fits inside its asserted interval.
  const placements: Array<{ candidate: TemporalPageCandidate; centerY: number }> = [];
  for (const candidate of candidates) {
    const occupiedPageBounds = placements.map((placement) => pageBounds(placement));
    const centerY = earliestOpenPageCenter({ candidate, occupiedPageBounds });
    placements.push({ candidate, centerY });
  }
  for (const placement of placements) {
    const occupiedPageBounds = placements
      .filter((other) => other !== placement)
      .map((other) => pageBounds(other));
    placement.centerY = preferredOpenPageCenter({
      candidate: placement.candidate,
      currentCenter: placement.centerY,
      occupiedPageBounds,
    });
  }
  const laidOutPages = placements.map(({ candidate, centerY }): TemporalHypermediaPage => {
    const bounds = pageBounds({ candidate, centerY });
    return {
      page: candidate.page,
      resourceKeys: candidate.resourceKeys,
      path: capsulePath(bounds),
      label: { x: (bounds.left + bounds.right) / 2, y: centerY },
      bounds,
      colorIndex: candidate.colorIndex,
    };
  });
  laidOutPages.sort(
    (first, second) =>
      first.bounds.top - second.bounds.top ||
      first.page.readableId.localeCompare(second.page.readableId),
  );
  const pageLoadBoundaryY =
    laidOutPages.length > 0 ? Math.max(...laidOutPages.map(({ bounds }) => bounds.bottom)) : null;
  const height = Math.max(
    baseHeight,
    ...laidOutPages.map(({ bounds }) => bounds.bottom + TIMELINE_BOTTOM_PADDING),
  );
  const span = extent.end - extent.start;
  const ticks = Array.from({ length: 9 }, (_, index): TemporalHypermediaTick => {
    const time = extent.end - (span * index) / 8;
    return {
      y: timeY({ time, extent, startY: TIMELINE_START_Y, endY: timelineEndY }),
      time,
    };
  });
  return {
    width,
    height,
    timelineStartY: TIMELINE_START_Y,
    timelineEndY,
    pageLoadBoundaryY,
    hasOverlappingPages: hasOverlappingPages(laidOutPages),
    extent,
    resources: columns,
    pages: laidOutPages,
    ticks,
  };
}

export function temporalScrollTopForRange({
  layout,
  range,
  viewportHeight,
}: {
  layout: TemporalHypermediaLayout;
  range?: CalendarDateRange;
  viewportHeight: number;
}): number {
  if (!range) {
    return 0;
  }
  const maximum = Math.max(0, layout.height - viewportHeight);
  const center =
    ((epochDayFromCalendarDate(range.from) + epochDayFromCalendarDate(range.to)) / 2) *
    MILLISECONDS_PER_DAY;
  const centerY = timeY({
    time: center,
    extent: layout.extent,
    startY: layout.timelineStartY,
    endY: layout.timelineEndY,
  });
  return clamp(centerY - viewportHeight / 2, 0, maximum);
}
