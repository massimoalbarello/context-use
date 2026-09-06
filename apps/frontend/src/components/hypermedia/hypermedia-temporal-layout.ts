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
} from './hypermedia-layout';

const MILLISECONDS_PER_DAY = 86_400_000;
const MINIMUM_TIMELINE_WIDTH = 1_900;
const MAXIMUM_TIMELINE_WIDTH = 24_000;
const PIXELS_PER_DAY = 0.75;
const TIMELINE_HORIZONTAL_PADDING = 120;
const TIMELINE_HEADER_HEIGHT = 64;
const RESOURCE_ROW_HEIGHT = 116;
const RESOURCE_VERTICAL_PADDING = 80;
const MINIMUM_CANVAS_HEIGHT = 620;
const CLOUD_HORIZONTAL_PADDING = 34;
const CLOUD_HEIGHT = 52;
const CLOUD_LANE_ORIGIN = TIMELINE_HEADER_HEIGHT + 40;
const CLOUD_LANE_SPACING = 76;
const CLOUD_HORIZONTAL_GAP = 24;
const MINIMUM_CLOUD_WIDTH = 240;

type TemporalExtent = NonNullable<HypermediaPages['temporalExtent']>;

export type TemporalHypermediaResource = HypermediaResourceReference & {
  key: string;
  label: string;
  y: number;
  resource?: HypermediaLayoutResource;
};

export type TemporalHypermediaPage = {
  page: HypermediaPage;
  resourceKeys: string[];
  path: string;
  label: { x: number; y: number };
  bounds: { left: number; right: number; top: number; bottom: number };
  colorIndex: number;
  start: number;
  end: number;
};

export type TemporalHypermediaTick = {
  x: number;
  time: number;
  label: string;
};

export type TemporalHypermediaLayout = {
  width: number;
  height: number;
  timelineStartX: number;
  timelineEndX: number;
  extent: TemporalExtent;
  resources: TemporalHypermediaResource[];
  pages: TemporalHypermediaPage[];
  ticks: TemporalHypermediaTick[];
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

function timelineWidth(extent: TemporalExtent): number {
  const days = Math.max(1, (extent.end - extent.start) / MILLISECONDS_PER_DAY);
  return Math.min(
    MAXIMUM_TIMELINE_WIDTH,
    Math.max(MINIMUM_TIMELINE_WIDTH, days * PIXELS_PER_DAY + TIMELINE_HORIZONTAL_PADDING * 2),
  );
}

function timeX({
  time,
  extent,
  startX,
  endX,
}: {
  time: number;
  extent: TemporalExtent;
  startX: number;
  endX: number;
}): number {
  if (extent.start === extent.end) {
    return (startX + endX) / 2;
  }
  const progress =
    (clamp(time, extent.start, extent.end) - extent.start) / (extent.end - extent.start);
  return startX + progress * (endX - startX);
}

function timeAtX({ x, layout }: { x: number; layout: TemporalHypermediaLayout }): number {
  if (layout.timelineStartX === layout.timelineEndX) {
    return layout.extent.start;
  }
  const progress =
    (clamp(x, layout.timelineStartX, layout.timelineEndX) - layout.timelineStartX) /
    (layout.timelineEndX - layout.timelineStartX);
  return layout.extent.start + progress * (layout.extent.end - layout.extent.start);
}

function cloudPath({
  left,
  right,
  top,
  bottom,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}): string {
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

function resourceRows({
  resources,
  pages,
}: {
  resources: HypermediaLayoutResource[];
  pages: HypermediaPage[];
}): TemporalHypermediaResource[] {
  const rows = new Map<string, Omit<TemporalHypermediaResource, 'y'>>();
  for (const resource of resources) {
    const reference = hypermediaLayoutResourceReference(resource);
    rows.set(resource.key, {
      key: resource.key,
      ...reference,
      label: hypermediaLayoutResourceLabel(resource),
      resource,
    });
  }
  for (const reference of pages.flatMap(({ resources: references }) => references)) {
    const key = hypermediaResourceKey(reference);
    if (!rows.has(key)) {
      rows.set(key, { ...reference, key, label: fallbackResourceLabel(reference) });
    }
  }
  return [...rows.values()].map((row, index) => ({
    ...row,
    y: TIMELINE_HEADER_HEIGHT + RESOURCE_VERTICAL_PADDING + index * RESOURCE_ROW_HEIGHT,
  }));
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
  const width = timelineWidth(extent);
  const timelineStartX = TIMELINE_HORIZONTAL_PADDING;
  const timelineEndX = width - TIMELINE_HORIZONTAL_PADDING;
  const temporalPages = pages.filter(({ temporalCoverage }) => temporalCoverage !== null);
  const rows = resourceRows({ resources, pages: temporalPages });
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const candidates = temporalPages.flatMap((page) => {
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
    const connectedRows = resourceKeys.flatMap((resourceKey) => {
      const row = rowByKey.get(resourceKey);
      return row ? [row] : [];
    });
    if (connectedRows.length === 0) {
      return [];
    }
    const startPosition = timeX({
      time: start,
      extent,
      startX: timelineStartX,
      endX: timelineEndX,
    });
    const endPosition = timeX({ time: end, extent, startX: timelineStartX, endX: timelineEndX });
    const centerX = (startPosition + endPosition) / 2;
    const left = Math.min(
      startPosition - CLOUD_HORIZONTAL_PADDING,
      centerX - MINIMUM_CLOUD_WIDTH / 2,
    );
    const right = Math.max(
      endPosition + CLOUD_HORIZONTAL_PADDING,
      centerX + MINIMUM_CLOUD_WIDTH / 2,
    );
    return [
      {
        page,
        resourceKeys,
        left,
        right,
        preferredY: connectedRows.reduce((total, { y }) => total + y, 0) / connectedRows.length,
        colorIndex: hypermediaPageColorIndex(page.readableId),
        start,
        end,
      },
    ];
  });
  candidates.sort(
    (first, second) =>
      first.start - second.start ||
      first.end - second.end ||
      first.page.readableId.localeCompare(second.page.readableId),
  );
  const occupiedByLane = new Map<number, Array<{ left: number; right: number }>>();
  const laidOutPages = candidates.map((candidate): TemporalHypermediaPage => {
    const preferredLane = Math.max(
      0,
      Math.round((candidate.preferredY - CLOUD_LANE_ORIGIN) / CLOUD_LANE_SPACING),
    );
    let lane = preferredLane;
    for (let distance = 0; distance <= candidates.length + rows.length; distance += 1) {
      const possibleLanes =
        distance === 0
          ? [preferredLane]
          : [preferredLane - distance, preferredLane + distance].filter(
              (possibleLane) => possibleLane >= 0,
            );
      const availableLane = possibleLanes.find((possibleLane) =>
        (occupiedByLane.get(possibleLane) ?? []).every(
          (occupied) =>
            candidate.left >= occupied.right + CLOUD_HORIZONTAL_GAP ||
            candidate.right + CLOUD_HORIZONTAL_GAP <= occupied.left,
        ),
      );
      if (availableLane !== undefined) {
        lane = availableLane;
        break;
      }
    }
    const centerY = CLOUD_LANE_ORIGIN + lane * CLOUD_LANE_SPACING;
    const bounds = {
      left: candidate.left,
      right: candidate.right,
      top: centerY - CLOUD_HEIGHT / 2,
      bottom: centerY + CLOUD_HEIGHT / 2,
    };
    occupiedByLane.set(lane, [
      ...(occupiedByLane.get(lane) ?? []),
      { left: bounds.left, right: bounds.right },
    ]);
    return {
      page: candidate.page,
      resourceKeys: candidate.resourceKeys,
      path: cloudPath(bounds),
      label: { x: (bounds.left + bounds.right) / 2, y: centerY },
      bounds,
      colorIndex: candidate.colorIndex,
      start: candidate.start,
      end: candidate.end,
    };
  });
  const rowBottom = rows.at(-1)?.y ?? 0;
  const pageBottom = Math.max(0, ...laidOutPages.map(({ bounds }) => bounds.bottom));
  const height = Math.max(
    MINIMUM_CANVAS_HEIGHT,
    rowBottom + RESOURCE_VERTICAL_PADDING,
    pageBottom + RESOURCE_VERTICAL_PADDING,
  );
  const span = extent.end - extent.start;
  const ticks = Array.from({ length: 9 }, (_, index): TemporalHypermediaTick => {
    const time = extent.start + (span * index) / 8;
    return {
      x: timeX({ time, extent, startX: timelineStartX, endX: timelineEndX }),
      time,
      label: tickLabel(time, span),
    };
  });
  return {
    width,
    height,
    timelineStartX,
    timelineEndX,
    extent,
    resources: rows,
    pages: laidOutPages,
    ticks,
  };
}

export function temporalRangeForViewport({
  layout,
  scrollLeft,
  viewportWidth,
}: {
  layout: TemporalHypermediaLayout;
  scrollLeft: number;
  viewportWidth: number;
}): CalendarDateRange {
  const from = timeAtX({ x: scrollLeft, layout });
  const to = timeAtX({ x: scrollLeft + viewportWidth, layout });
  return {
    from: calendarDateFromEpochDay(Math.floor(from / MILLISECONDS_PER_DAY)),
    to: calendarDateFromEpochDay(Math.floor(to / MILLISECONDS_PER_DAY)),
  };
}

export function temporalScrollLeftForRange({
  layout,
  range,
  viewportWidth,
}: {
  layout: TemporalHypermediaLayout;
  range?: CalendarDateRange;
  viewportWidth: number;
}): number {
  const maximum = Math.max(0, layout.width - viewportWidth);
  if (!range) {
    return maximum;
  }
  const center =
    ((epochDayFromCalendarDate(range.from) + epochDayFromCalendarDate(range.to)) / 2) *
    MILLISECONDS_PER_DAY;
  const centerX = timeX({
    time: center,
    extent: layout.extent,
    startX: layout.timelineStartX,
    endX: layout.timelineEndX,
  });
  return clamp(centerX - viewportWidth / 2, 0, maximum);
}
