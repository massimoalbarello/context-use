import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

function TimeFilterExplanation() {
  return (
    <div className="space-y-1">
      <h2 className="font-medium text-sm">Filter pages by time</h2>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Choose a month to show pages whose time interval overlaps it. Undated shows pages without a
        time interval.
      </p>
    </div>
  );
}

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

export function MapIntervalIndicator({
  month,
  onMonthChange,
}: {
  month?: CalendarMonth;
  onMonthChange: (month?: CalendarMonth) => void;
}) {
  const options = useMemo(() => monthOptions(month), [month]);
  const narrow = useNarrowWorkspace();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const expanded = (hovered || focused) && !dismissed;
  useEffect(() => {
    if (!expanded) {
      return;
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDismissed(true);
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [expanded]);
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
    <nav className="select-none" aria-label="Time navigation">
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
          <PopoverContent
            side="bottom"
            align="center"
            sideOffset={({ anchor, positioner }) => -(anchor.height + positioner.height) / 2}
            collisionAvoidance={{ side: 'shift', align: 'shift' }}
            className="w-64 max-w-[calc(100vw-2rem)] p-4"
            aria-label="Filter pages by time"
          >
            <TimeFilterExplanation />
            <div className="mx-auto mt-3 w-25">{picker}</div>
          </PopoverContent>
        </Popover>
      ) : (
        <fieldset
          aria-label="Filter pages by time"
          className={cn(
            '-m-3 flex items-center gap-4 rounded-xl border border-transparent p-3',
            expanded && 'border-border bg-popover text-popover-foreground shadow-lg',
          )}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') {
              setHovered(true);
              setDismissed(false);
            }
          }}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setFocused(false);
            }
          }}
        >
          <div hidden={!expanded} className="w-44">
            <TimeFilterExplanation />
          </div>
          <div className="w-25 shrink-0">{picker}</div>
        </fieldset>
      )}
    </nav>
  );
}
