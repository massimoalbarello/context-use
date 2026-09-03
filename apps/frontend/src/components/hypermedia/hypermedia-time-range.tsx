import { CalendarRange, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type CalendarDateRange,
  calendarDateFromEpochDay,
  epochDayFromCalendarDate,
} from '../../lib/temporal-coverage';
import type { HypermediaPages } from '../../queries/hypermedia';
import { Button } from '../ui/button';
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
    <div className="shrink-0 border-b bg-card px-4 py-3">
      {error ? (
        <div className="flex items-center justify-center gap-3 text-sm" role="alert">
          <span className="text-destructive">Couldn’t load pages.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : extent ? (
        <div className="mx-auto grid max-w-4xl gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:flex">
            <span className="flex min-w-0 items-center gap-2 font-medium text-sm sm:flex-1">
              <CalendarRange className="size-4 text-muted-foreground" aria-hidden="true" />
              <span>Time range</span>
            </span>
            <output className="col-span-2 row-start-2 justify-self-end text-muted-foreground text-xs tabular-nums sm:order-2 sm:col-span-1 sm:justify-self-auto">
              {dateLabel(draft[0])} – {dateLabel(draft[1])}
            </output>
            {value && (
              <Button
                className="col-start-2 row-start-1 sm:order-3"
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onApply(undefined)}
              >
                <RotateCcw aria-hidden="true" />
                All time
              </Button>
            )}
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
        </div>
      ) : null}
      {hasMore && (
        <p
          className="mx-auto mt-2 max-w-4xl rounded-lg border bg-muted/55 px-3 py-2 text-center text-sm"
          role="status"
        >
          This view is too dense. Select entities or narrow the time range.
        </p>
      )}
    </div>
  );
}
