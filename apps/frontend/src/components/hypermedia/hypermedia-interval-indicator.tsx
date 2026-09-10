import type { CSSProperties } from 'react';
import {
  type CalendarMonth,
  calendarMonthLabel,
  currentCalendarMonth,
  mapMonthAfterScroll,
} from '../../lib/calendar-month';

export const HYPERMEDIA_TIMELINE_HEADER_HEIGHT = 112;

const MONTH_POSITION_DISTANCE = 6;
const MARKER_EDGE_CLEARANCE = 18;
const PRESENT_POSITION = HYPERMEDIA_TIMELINE_HEADER_HEIGHT + MARKER_EDGE_CLEARANCE;
const MIN_POSITION = 3;
const PAST_POSITION = 94;
const MAX_MONTH_POSITION = 14;
const MONTHS_PER_YEAR = 12;
const NOW_LABEL_FADE_DISTANCE = 0.3;

function monthOrdinal(value: CalendarMonth): number {
  const [year = 0, month = 1] = value.split('-').map(Number);
  return year * MONTHS_PER_YEAR + month - 1;
}

function intervalPosition({ month, now }: { month?: CalendarMonth; now: Date }): number {
  if (!month) {
    return -1;
  }
  const present = currentCalendarMonth(now);
  const selectedDistance = Math.max(0, monthOrdinal(present) - monthOrdinal(month));
  return Math.min(MAX_MONTH_POSITION, selectedDistance);
}

function scrollPosition({
  month,
  scrollProgress,
  now,
}: {
  month?: CalendarMonth;
  scrollProgress: number;
  now: Date;
}): number {
  const currentPosition = intervalPosition({ month, now });
  if (scrollProgress === 0) {
    return currentPosition;
  }
  const direction = scrollProgress > 0 ? 'older' : 'newer';
  const adjacentMonth = mapMonthAfterScroll({ month, direction, now });
  if (adjacentMonth === month) {
    return currentPosition;
  }
  const adjacentPosition = intervalPosition({ month: adjacentMonth, now });
  return (
    currentPosition + (adjacentPosition - currentPosition) * Math.min(1, Math.abs(scrollProgress))
  );
}

function intervalPositionStyle(position: number): string {
  if (position < 0) {
    const progressFromTop = position + 1;
    if (progressFromTop <= 0) {
      return `${MIN_POSITION}%`;
    }
    const percentagePosition = (1 - progressFromTop) * MIN_POSITION;
    const pixelPosition = progressFromTop * PRESENT_POSITION;
    return `clamp(${MIN_POSITION}%, calc(${percentagePosition}% + ${pixelPosition}px), ${PAST_POSITION}%)`;
  }
  const distance = position * MONTH_POSITION_DISTANCE;
  return `clamp(${MIN_POSITION}%, calc(${PRESENT_POSITION}px + ${distance}%), ${PAST_POSITION}%)`;
}

function nowLabelOpacity(position: number): number {
  return position < 0 ? Math.min(1, -position / NOW_LABEL_FADE_DISTANCE) : 1;
}

export function HypermediaIntervalIndicator({
  month,
  scrollProgress = 0,
}: {
  month?: CalendarMonth;
  scrollProgress?: number;
}) {
  const now = new Date();
  const present = currentCalendarMonth(now);
  const label = calendarMonthLabel(month);
  const position = scrollPosition({ month, scrollProgress, now });
  const selectedIsPresent = month === present;

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-40 select-none">
      <span className="absolute inset-y-0 right-3 w-px bg-border/80" aria-hidden="true" />
      {!selectedIsPresent && (
        <span
          className="absolute right-7 -translate-y-1/2 text-muted-foreground text-xs transition-opacity duration-100 ease-out motion-reduce:transition-none"
          style={{ top: PRESENT_POSITION, opacity: nowLabelOpacity(position) }}
        >
          Now
        </span>
      )}
      <span className="absolute right-7 bottom-[2%] text-muted-foreground text-xs">Past</span>
      <div
        className="absolute inset-x-0 -translate-y-1/2"
        style={
          {
            '--interval-position': intervalPositionStyle(position),
            top: 'var(--interval-position)',
          } as CSSProperties
        }
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
