import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import {
  type CalendarMonth,
  calendarMonthLabel,
  calendarMonthShortLabel,
  mapMonthAfterScroll,
} from '../../lib/calendar-month';
import { calendarNow } from '../../lib/calendar-now';

const NEIGHBOR_MONTH_COUNT = 2;
const MONTH_ROW_HEIGHT = 32;

function visibleMonths(month?: CalendarMonth) {
  const now = calendarNow();
  const months = [{ month, offset: 0 }];
  let newer = month;
  let older = month;
  for (let distance = 1; distance <= NEIGHBOR_MONTH_COUNT; distance += 1) {
    if (newer !== undefined) {
      newer = mapMonthAfterScroll({ month: newer, direction: 'newer', now });
      months.unshift({ month: newer, offset: -distance });
    }
    older = mapMonthAfterScroll({ month: older, direction: 'older', now });
    months.push({ month: older, offset: distance });
  }
  return months;
}

export function HypermediaIntervalIndicator({
  month,
  onMonthChange,
}: {
  month?: CalendarMonth;
  onMonthChange: (month?: CalendarMonth) => void;
}) {
  return (
    <nav className="absolute top-4 right-4 z-10 h-40 w-30 select-none" aria-label="Time navigation">
      {visibleMonths(month).map(({ month: visibleMonth, offset }) => (
        <Button
          key={visibleMonth ?? 'undated'}
          type="button"
          variant={offset === 0 ? 'outline' : 'ghost'}
          size="sm"
          className={cn(
            'absolute top-16 left-0 h-8 w-30 justify-start px-2 text-sm tabular-nums transition-transform duration-150 ease-out motion-reduce:transition-none',
            offset === 0 ? 'font-medium' : 'font-normal text-muted-foreground',
            Math.abs(offset) === NEIGHBOR_MONTH_COUNT && 'opacity-60',
          )}
          style={{ transform: `translateY(${offset * MONTH_ROW_HEIGHT}px)` }}
          aria-label={calendarMonthLabel(visibleMonth)}
          aria-current={offset === 0 ? 'true' : undefined}
          onClick={() => onMonthChange(visibleMonth)}
        >
          {calendarMonthShortLabel(visibleMonth)}
        </Button>
      ))}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Selected interval: {calendarMonthLabel(month)}
      </span>
    </nav>
  );
}
