import { CalendarRange, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { enGB } from 'react-day-picker/locale';
import { cn } from '../../lib/class-names';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { Button } from '../ui/button';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function dateFromCalendarValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year ?? 0, (month ?? 1) - 1, day ?? 1);
  return date;
}

export function calendarValueFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickerRangeFrom(value?: CalendarDateRange): DateRange | undefined {
  return value
    ? { from: dateFromCalendarValue(value.from), to: dateFromCalendarValue(value.to) }
    : undefined;
}

export function calendarDateRangeFromSelection(
  selection?: DateRange,
): CalendarDateRange | undefined {
  if (!selection?.from) {
    return undefined;
  }
  return {
    from: calendarValueFromDate(selection.from),
    to: calendarValueFromDate(selection.to ?? selection.from),
  };
}

export function dateRangeButtonLabel(value?: CalendarDateRange): string {
  if (!value) {
    return 'Choose dates';
  }
  const from = dateFromCalendarValue(value.from);
  const to = dateFromCalendarValue(value.to);
  if (value.from === value.to) {
    return DATE_FORMATTER.format(from);
  }
  return `${DATE_FORMATTER.format(from)} – ${DATE_FORMATTER.format(to)}`;
}

export function PageDateRangeFilter({
  value,
  onApply,
  className,
  label = 'Filter by date range',
}: {
  value?: CalendarDateRange;
  onApply: (value?: CalendarDateRange) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DateRange | undefined>(() => pickerRangeFrom(value));
  const hasSelection = Boolean(selected?.from);

  return (
    <div className={cn('mb-2 grid gap-2 rounded-xl bg-muted/55 p-3', className)}>
      <p className="font-medium text-xs">{label}</p>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setSelected(pickerRangeFrom(value));
          }
          setOpen(nextOpen);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              className="w-full justify-start overflow-hidden font-normal"
              type="button"
              variant="outline"
            />
          }
        >
          <CalendarRange data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{dateRangeButtonLabel(value)}</span>
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto overflow-hidden p-0">
          <Calendar
            mode="range"
            locale={enGB}
            selected={selected}
            defaultMonth={selected?.from}
            onSelect={setSelected}
          />
          <div className="flex items-center justify-between gap-2 border-border border-t p-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(undefined);
                onApply(undefined);
                setOpen(false);
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!hasSelection}
              onClick={() => {
                const nextRange = calendarDateRangeFromSelection(selected);
                if (!nextRange) {
                  return;
                }
                onApply(nextRange);
                setOpen(false);
              }}
            >
              Apply range
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <p className="text-muted-foreground text-xs">Semantic pages stay visible.</p>
    </div>
  );
}
