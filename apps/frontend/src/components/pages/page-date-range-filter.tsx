import { format } from 'date-fns';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { enGB } from 'react-day-picker/locale';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { Button } from '../ui/button';
import { Calendar } from '../ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

function dateFromCalendarValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
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

export function dateRangeButtonLabel(value?: CalendarDateRange): string {
  if (!value) {
    return 'Choose dates';
  }
  const from = dateFromCalendarValue(value.from);
  const to = dateFromCalendarValue(value.to);
  if (value.from === value.to) {
    return format(from, 'dd/MM/yyyy');
  }
  return `${format(from, 'dd/MM/yyyy')} – ${format(to, 'dd/MM/yyyy')}`;
}

export function PageDateRangeFilter({
  value,
  onApply,
}: {
  value?: CalendarDateRange;
  onApply: (value?: CalendarDateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DateRange | undefined>(() => pickerRangeFrom(value));
  const complete = Boolean(selected?.from && selected.to);

  return (
    <div className="mb-2 grid gap-2 rounded-xl bg-muted/55 p-3">
      <p className="font-medium text-xs">Filter by date range</p>
      <Popover open={open} onOpenChange={setOpen}>
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
              disabled={!complete}
              onClick={() => {
                if (!selected?.from || !selected.to) {
                  return;
                }
                onApply({
                  from: calendarValueFromDate(selected.from),
                  to: calendarValueFromDate(selected.to),
                });
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
