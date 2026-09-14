import { Button } from '@repo/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { ChevronsUpDown } from 'lucide-react';
import { useMemo } from 'react';
import {
  type CalendarMonth,
  calendarMonthLabel,
  calendarMonthShortLabel,
  mapMonthAfterScroll,
} from '../../lib/calendar-month';
import { calendarNow } from '../../lib/calendar-now';
import { useNarrowWorkspace } from '../../lib/hooks/use-narrow-workspace';
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
  const narrow = useNarrowWorkspace();
  const picker = (
    <WheelPicker
      label="Selected month"
      options={options}
      value={month ?? UNDATED}
      onValueChange={(value) => onMonthChange(value === UNDATED ? undefined : value)}
      visibleCount={12}
      optionItemHeight={32}
    />
  );

  return (
    <nav
      className="absolute top-1/2 right-4 z-10 -translate-y-1/2 select-none"
      aria-label="Time navigation"
    >
      {narrow ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs tabular-nums"
                aria-label={`Change month: ${calendarMonthLabel(month)}`}
              />
            }
          >
            {calendarMonthShortLabel(month)}
            <ChevronsUpDown className="size-3" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent side="left" align="center" className="w-28 p-2" aria-label="Choose month">
            {picker}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="w-25">{picker}</div>
      )}
    </nav>
  );
}
