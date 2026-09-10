import {
  type CalendarMonth,
  calendarMonth,
  calendarMonthLabel,
  currentCalendarMonth,
  mapMonthAfterScroll,
} from '../../lib/calendar-month';
import { cn } from '../../lib/class-names';
import type { HypermediaPages } from '../../queries/hypermedia';

const UNDATED_POSITION = 3;
const PRESENT_POSITION = 22;
const PAST_POSITION = 94;
const MONTHS_PER_YEAR = 12;
const DEFAULT_HISTORY_MONTHS = 12;

function monthOrdinal(value: CalendarMonth): number {
  const [year = 0, month = 1] = value.split('-').map(Number);
  return year * MONTHS_PER_YEAR + month - 1;
}

function intervalPosition({
  month,
  extent,
  now,
}: {
  month?: CalendarMonth;
  extent: HypermediaPages['temporalExtent'];
  now: Date;
}): number {
  if (!month) {
    return UNDATED_POSITION;
  }
  const present = currentCalendarMonth(now);
  const selectedDistance = Math.max(0, monthOrdinal(present) - monthOrdinal(month));
  const extentMonth = extent
    ? calendarMonth(new Date(extent.start).toISOString().slice(0, 'YYYY-MM'.length))
    : undefined;
  const extentDistance = extentMonth
    ? Math.max(1, monthOrdinal(present) - monthOrdinal(extentMonth))
    : DEFAULT_HISTORY_MONTHS;
  const totalDistance = Math.max(selectedDistance, extentDistance);
  const progress = Math.log1p(selectedDistance) / Math.log1p(totalDistance);
  return PRESENT_POSITION + progress * (PAST_POSITION - PRESENT_POSITION);
}

function scrollPosition({
  month,
  extent,
  scrollProgress,
  now,
}: {
  month?: CalendarMonth;
  extent: HypermediaPages['temporalExtent'];
  scrollProgress: number;
  now: Date;
}): number {
  const currentPosition = intervalPosition({ month, extent, now });
  if (scrollProgress === 0) {
    return currentPosition;
  }
  const direction = scrollProgress > 0 ? 'older' : 'newer';
  const adjacentMonth = mapMonthAfterScroll({ month, direction, now });
  if (adjacentMonth === month) {
    return currentPosition;
  }
  const adjacentPosition = intervalPosition({ month: adjacentMonth, extent, now });
  return (
    currentPosition + (adjacentPosition - currentPosition) * Math.min(1, Math.abs(scrollProgress))
  );
}

export function HypermediaIntervalIndicator({
  month,
  extent,
  scrollProgress = 0,
  scrolling = false,
}: {
  month?: CalendarMonth;
  extent: HypermediaPages['temporalExtent'];
  scrollProgress?: number;
  scrolling?: boolean;
}) {
  const now = new Date();
  const present = currentCalendarMonth(now);
  const label = calendarMonthLabel(month);
  const position = scrollPosition({ month, extent, scrollProgress, now });
  const selectedIsPresent = month === present;
  const motion = scrolling
    ? 'transition-none'
    : 'transition-[top] duration-200 ease-out motion-reduce:transition-none';

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-40 select-none">
      <span className="absolute inset-y-0 right-3 w-px bg-border/80" aria-hidden="true" />
      {!selectedIsPresent && (
        <span className="absolute top-[22%] right-7 -translate-y-1/2 text-muted-foreground text-xs">
          Now
        </span>
      )}
      <span className="absolute right-7 bottom-[2%] text-muted-foreground text-xs">Past</span>
      <div
        className={cn('absolute inset-x-0 -translate-y-1/2', motion)}
        style={{ top: `${position}%` }}
        role="img"
        aria-label={month ? `Selected interval: ${label}` : 'Pages without a time interval'}
      >
        <span
          className="absolute top-0 right-3 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-card/85"
          aria-hidden="true"
        />
        <span
          className="absolute top-0 right-7 -translate-y-1/2 whitespace-nowrap rounded-full border bg-card/92 px-2.5 py-1 font-medium text-xs tabular-nums shadow-sm backdrop-blur"
          aria-live="polite"
        >
          {label}
        </span>
      </div>
    </div>
  );
}
