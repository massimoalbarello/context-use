import {
  type CalendarMonth,
  calendarMonth,
  calendarMonthLabel,
  currentCalendarMonth,
} from '../../lib/calendar-month';
import type { HypermediaPages } from '../../queries/hypermedia';

const UNDATED_POSITION = 2;
const PRESENT_POSITION = 28;
const PAST_POSITION = 88;
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

export function HypermediaIntervalIndicator({
  month,
  extent,
}: {
  month?: CalendarMonth;
  extent: HypermediaPages['temporalExtent'];
}) {
  const now = new Date();
  const present = currentCalendarMonth(now);
  const label = calendarMonthLabel(month);
  const position = intervalPosition({ month, extent, now });
  const selectedIsPresent = month === present;

  return (
    <section aria-labelledby="hypermedia-interval-heading">
      <h3 id="hypermedia-interval-heading" className="font-medium text-xs">
        Interval
      </h3>
      <div className="relative mt-2 h-32" role="img" aria-label={`Selected interval: ${label}`}>
        <span className="absolute top-1 bottom-2 left-1.5 w-px bg-border" aria-hidden="true" />
        <span
          className="absolute left-0 size-3 -translate-y-1/2 rounded-full border-2 border-sidebar bg-foreground transition-[top] duration-300 ease-out motion-reduce:transition-none"
          style={{ top: `${position}%` }}
          aria-hidden="true"
        />
        {month && (
          <span className="absolute top-[2%] left-7 -translate-y-1/2 text-muted-foreground text-xs">
            Undated
          </span>
        )}
        {!selectedIsPresent && (
          <span className="absolute top-[28%] left-7 -translate-y-1/2 text-muted-foreground text-xs">
            Now
          </span>
        )}
        <p
          className="absolute left-7 -translate-y-1/2 font-medium text-sm tabular-nums transition-[top] duration-300 ease-out motion-reduce:transition-none"
          style={{ top: `${position}%` }}
          aria-live="polite"
        >
          {label}
        </p>
        <span className="absolute bottom-0 left-7 text-muted-foreground text-xs">Past</span>
      </div>
      <p className="text-muted-foreground text-xs">Scroll one month at a time.</p>
    </section>
  );
}
