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
const RESOURCE_ROW_HEIGHT = 92;
const RESOURCE_VERTICAL_PADDING = 56;
const MINIMUM_CANVAS_HEIGHT = 620;
const CLOUD_HORIZONTAL_PADDING = 38;
const CLOUD_VERTICAL_PADDING = 28;
const MINIMUM_CLOUD_WIDTH = 112;

export const TEMPORAL_RESOURCE_LABEL_WIDTH = 216;

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
  const horizontalRadius = Math.min(32, (right - left) / 5);
  const verticalRadius = Math.min(24, (bottom - top) / 4);
  const middleX = (left + right) / 2;
  const middleY = (top + bottom) / 2;
  return [
    `M ${left + horizontalRadius} ${top}`,
    `C ${left + horizontalRadius / 2} ${top - 8} ${middleX - horizontalRadius} ${top - 8} ${middleX} ${top}`,
    `C ${middleX + horizontalRadius} ${top - 8} ${right - horizontalRadius / 2} ${top - 8} ${right - horizontalRadius} ${top}`,
    `C ${right + 8} ${top + verticalRadius} ${right + 8} ${middleY - verticalRadius} ${right} ${middleY}`,
    `C ${right + 8} ${middleY + verticalRadius} ${right + 8} ${bottom - verticalRadius} ${right - horizontalRadius} ${bottom}`,
    `C ${right - horizontalRadius / 2} ${bottom + 8} ${middleX + horizontalRadius} ${bottom + 8} ${middleX} ${bottom}`,
    `C ${middleX - horizontalRadius} ${bottom + 8} ${left + horizontalRadius / 2} ${bottom + 8} ${left + horizontalRadius} ${bottom}`,
    `C ${left - 8} ${bottom - verticalRadius} ${left - 8} ${middleY + verticalRadius} ${left} ${middleY}`,
    `C ${left - 8} ${middleY - verticalRadius} ${left - 8} ${top + verticalRadius} ${left + horizontalRadius} ${top}`,
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
  const laidOutPages = temporalPages.flatMap((page): TemporalHypermediaPage[] => {
    if (!page.temporalCoverage) {
      return [];
    }
    const coverage = parseTemporalCoverage(temporalCoverageExpression(page.temporalCoverage));
    const start = clamp(coverage.bounds.start, extent.start, extent.end);
    const inclusiveEnd = coverage.bounds.end
      ? coverage.bounds.end - MILLISECONDS_PER_DAY
      : extent.end;
    const end = clamp(Math.max(start, inclusiveEnd), extent.start, extent.end);
    const connectedRows = page.resources.flatMap((reference) => {
      const row = rowByKey.get(hypermediaResourceKey(reference));
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
    const top = Math.min(...connectedRows.map(({ y }) => y)) - CLOUD_VERTICAL_PADDING;
    const bottom = Math.max(...connectedRows.map(({ y }) => y)) + CLOUD_VERTICAL_PADDING;
    return [
      {
        page,
        resourceKeys: page.resources.map(hypermediaResourceKey),
        path: cloudPath({ left, right, top, bottom }),
        label: { x: centerX, y: (top + bottom) / 2 },
        colorIndex: hypermediaPageColorIndex(page.readableId),
        start,
        end,
      },
    ];
  });
  const height = Math.max(
    MINIMUM_CANVAS_HEIGHT,
    TIMELINE_HEADER_HEIGHT + RESOURCE_VERTICAL_PADDING * 2 + rows.length * RESOURCE_ROW_HEIGHT,
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
