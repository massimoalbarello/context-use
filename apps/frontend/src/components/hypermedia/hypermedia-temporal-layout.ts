// biome-ignore-all lint/style/noMagicNumbers: Temporal canvas geometry is expressed by visual constants.
// biome-ignore-all lint/complexity/useMaxParams: Collection callbacks and geometry helpers are locally scoped.

import { parseTemporalCoverage } from '@repo/backend/temporal-coverage';
import {
  type CalendarDateRange,
  calendarDateFromEpochDay,
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
const MINIMUM_TIMELINE_HEIGHT = 2_800;
const MAXIMUM_TIMELINE_HEIGHT = 24_000;
const PIXELS_PER_DAY = 1.25;
const RESOURCE_COLUMN_START_X = 176;
const RESOURCE_COLUMN_SPACING = 180;
const RESOURCE_RIGHT_PADDING = 128;
const TIMELINE_START_Y = 144;
const TIMELINE_BOTTOM_PADDING = 120;
const PAGE_RESOURCE_PADDING = 52;
const PAGE_HEIGHT = 48;
const PAGE_GAP = 8;
const PAGE_STACK_SPACING = PAGE_HEIGHT + PAGE_GAP;
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
  label: string;
};

export type TemporalHypermediaLayout = {
  width: number;
  height: number;
  timelineStartY: number;
  timelineEndY: number;
  pageLoadBoundaryY: number | null;
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

function timeAtY({ y, layout }: { y: number; layout: TemporalHypermediaLayout }): number {
  if (layout.timelineStartY === layout.timelineEndY) {
    return layout.extent.end;
  }
  const progress =
    (clamp(y, layout.timelineStartY, layout.timelineEndY) - layout.timelineStartY) /
    (layout.timelineEndY - layout.timelineStartY);
  return layout.extent.end - progress * (layout.extent.end - layout.extent.start);
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

function tickLabel(time: number, span: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: span > MILLISECONDS_PER_DAY * 365 * 5 ? undefined : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(time));
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

function openPageCenter({
  candidate,
  occupiedPageBounds,
}: {
  candidate: TemporalPageCandidate;
  occupiedPageBounds: Bounds[];
}): number | undefined {
  const intervalSpan = candidate.maximumY - candidate.minimumY;
  const maximumSteps = Math.ceil(intervalSpan / PAGE_STACK_SPACING);
  const possibleCenters = [candidate.preferredY];
  for (let step = 1; step <= maximumSteps; step += 1) {
    const offset = step * PAGE_STACK_SPACING;
    if (candidate.preferredY + offset <= candidate.maximumY) {
      possibleCenters.push(candidate.preferredY + offset);
    }
    if (candidate.preferredY - offset >= candidate.minimumY) {
      possibleCenters.push(candidate.preferredY - offset);
    }
  }
  possibleCenters.push(candidate.minimumY, candidate.maximumY);
  return possibleCenters.find((centerY) => {
    const bounds = pageBounds({ candidate, centerY });
    return !occupiedPageBounds.some((occupied) => pageBoundsOverlap(bounds, occupied));
  });
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
  const pageLoadBoundaryY = candidates.at(-1)?.minimumY ?? null;
  candidates.sort(
    (first, second) =>
      first.preferredY - second.preferredY ||
      first.duration - second.duration ||
      first.page.readableId.localeCompare(second.page.readableId),
  );

  const occupiedPageBounds: Bounds[] = [];
  const laidOutPages = candidates.map((candidate): TemporalHypermediaPage => {
    let centerY = openPageCenter({ candidate, occupiedPageBounds }) ?? candidate.maximumY;
    let bounds = pageBounds({ candidate, centerY });
    while (occupiedPageBounds.some((occupied) => pageBoundsOverlap(bounds, occupied))) {
      centerY += PAGE_STACK_SPACING;
      bounds = pageBounds({ candidate, centerY });
    }
    occupiedPageBounds.push(bounds);
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
      label: tickLabel(time, span),
    };
  });
  return {
    width,
    height,
    timelineStartY: TIMELINE_START_Y,
    timelineEndY,
    pageLoadBoundaryY,
    extent,
    resources: columns,
    pages: laidOutPages,
    ticks,
  };
}

export function temporalRangeForViewport({
  layout,
  scrollTop,
  viewportHeight,
}: {
  layout: TemporalHypermediaLayout;
  scrollTop: number;
  viewportHeight: number;
}): CalendarDateRange {
  const newer = timeAtY({ y: scrollTop, layout });
  const older = timeAtY({ y: scrollTop + viewportHeight, layout });
  return {
    from: calendarDateFromEpochDay(Math.floor(older / MILLISECONDS_PER_DAY)),
    to: calendarDateFromEpochDay(Math.floor(newer / MILLISECONDS_PER_DAY)),
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
