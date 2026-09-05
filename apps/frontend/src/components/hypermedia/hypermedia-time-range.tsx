import { CalendarRange, ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type CalendarDateRange,
  calendarDateFromEpochDay,
  epochDayFromCalendarDate,
} from '../../lib/temporal-coverage';
import type { HypermediaPages } from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '../ui/slider';

const MILLISECONDS_PER_DAY = 86_400_000;
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

type TemporalExtent = NonNullable<HypermediaPages['temporalExtent']>;
type DayRange = readonly [number, number];

function epochDayFromMilliseconds(value: number): number {
  return Math.floor(value / MILLISECONDS_PER_DAY);
}

function clamp({
  value,
  minimum,
  maximum,
}: {
  value: number;
  minimum: number;
  maximum: number;
}): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function dayRange({
  value,
  minimum,
  maximum,
}: {
  value?: CalendarDateRange;
  minimum: number;
  maximum: number;
}): DayRange {
  if (!value) {
    return [minimum, maximum];
  }
  const from = clamp({ value: epochDayFromCalendarDate(value.from), minimum, maximum });
  const to = clamp({ value: epochDayFromCalendarDate(value.to), minimum, maximum });
  return [Math.min(from, to), Math.max(from, to)];
}

function dateLabel(day: number): string {
  return DATE_FORMATTER.format(new Date(day * MILLISECONDS_PER_DAY));
}

function ariaDateLabel(...[, day]: [string, number, number]): string {
  return dateLabel(day);
}

function rangeLabel(value?: CalendarDateRange): string {
  if (!value) {
    return 'All time';
  }
  return `${dateLabel(epochDayFromCalendarDate(value.from))} – ${dateLabel(
    epochDayFromCalendarDate(value.to),
  )}`;
}

export function HypermediaTimeRange({
  value,
  extent,
  hasMore,
  loading,
  error,
  onApply,
  onRetry,
}: {
  value?: CalendarDateRange;
  extent: TemporalExtent | null;
  hasMore: boolean;
  loading: boolean;
  error: Error | null;
  onApply: (value?: CalendarDateRange) => void;
  onRetry: () => void;
}) {
  const minimum = extent ? epochDayFromMilliseconds(extent.start) : 0;
  const maximum = extent ? epochDayFromMilliseconds(extent.end) : 0;
  const appliedRange = dayRange({ value, minimum, maximum });
  const [draft, setDraft] = useState<DayRange>(appliedRange);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(appliedRange);
  }, [appliedRange[0], appliedRange[1]]);

  if (!error && !extent && !hasMore) {
    return null;
  }

  function commit(next: readonly number[]) {
    const range: DayRange = [next[0] ?? minimum, next[1] ?? maximum];
    if (range[0] === minimum && range[1] === maximum) {
      onApply(undefined);
      return;
    }
    onApply({
      from: calendarDateFromEpochDay(range[0]),
      to: calendarDateFromEpochDay(range[1]),
    });
  }

  return (
    <div className="grid gap-2 rounded-xl bg-muted/55 p-3">
      {error ? (
        <div className="grid gap-2 text-sm" role="alert">
          <p className="font-medium text-xs">Time range</p>
          <span className="text-destructive">Couldn’t load pages.</span>
          <Button
            className="justify-self-start"
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      ) : extent ? (
        <>
          <p className="font-medium text-xs">Time range</p>
          <Popover
            open={open}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setDraft(appliedRange);
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
              <span className="min-w-0 flex-1 truncate text-left">{rangeLabel(value)}</span>
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="right"
              className="grid w-[min(22rem,calc(100vw-2rem))] gap-3 p-4"
              aria-label="Choose time range"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-sm">Pages in time</p>
                <output className="text-right text-muted-foreground text-xs tabular-nums">
                  {dateLabel(draft[0])} – {dateLabel(draft[1])}
                </output>
              </div>
              {minimum < maximum && (
                <Slider
                  value={draft}
                  min={minimum}
                  max={maximum}
                  step={1}
                  thumbCollisionBehavior="none"
                  disabled={loading}
                  onValueChange={(next) => setDraft([next[0] ?? minimum, next[1] ?? maximum])}
                  onValueCommitted={commit}
                >
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb
                        index={0}
                        getAriaLabel={() => 'Start date'}
                        getAriaValueText={ariaDateLabel}
                      />
                      <SliderThumb
                        index={1}
                        getAriaLabel={() => 'End date'}
                        getAriaValueText={ariaDateLabel}
                      />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
              )}
              <div className="flex items-center justify-end gap-2 border-t pt-3">
                {value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraft([minimum, maximum]);
                      onApply(undefined);
                    }}
                  >
                    <RotateCcw aria-hidden="true" />
                    All time
                  </Button>
                )}
                <Button type="button" size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      ) : null}
      {hasMore && (
        <p className="rounded-lg border bg-background/60 px-3 py-2 text-sm" role="status">
          This view is too dense. Select entities or narrow the time range.
        </p>
      )}
    </div>
  );
}
