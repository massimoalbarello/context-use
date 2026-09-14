import { useMemo } from 'react';
import {
  type CalendarMonth,
  calendarMonthLabel,
  calendarMonthShortLabel,
  mapMonthAfterScroll,
} from '../../lib/calendar-month';
import { calendarNow } from '../../lib/calendar-now';
import { WheelPicker } from '../ui/wheel-picker';

const UNDATED = 'undated';
const BUFFER_MONTH_COUNT = 24;

function monthOptions(month?: CalendarMonth) {
  const now = calendarNow();
  const months = [month];
  let newer = month;
  let older = month;
  // Recenter after selection so older months remain available without rendering the entire calendar.
  for (let distance = 1; distance <= BUFFER_MONTH_COUNT; distance += 1) {
    if (newer !== undefined) {
      newer = mapMonthAfterScroll({ month: newer, direction: 'newer', now });
      months.unshift(newer);
    }
    older = mapMonthAfterScroll({ month: older, direction: 'older', now });
    months.push(older);
  }
  return months.map((value) => ({
    value: (value ?? UNDATED) as CalendarMonth | typeof UNDATED,
    label: calendarMonthShortLabel(value),
    textValue: calendarMonthLabel(value),
  }));
}

export function HypermediaIntervalIndicator({
  month,
  onMonthChange,
}: {
  month?: CalendarMonth;
  onMonthChange: (month?: CalendarMonth) => void;
}) {
  const options = useMemo(() => monthOptions(month), [month]);

  return (
    <nav className="absolute right-4 bottom-16 z-10 w-25 select-none" aria-label="Time navigation">
      <WheelPicker
        label="Selected month"
        options={options}
        value={month ?? UNDATED}
        onValueChange={(value) => onMonthChange(value === UNDATED ? undefined : value)}
        visibleCount={12}
        optionItemHeight={32}
      />
    </nav>
  );
}
