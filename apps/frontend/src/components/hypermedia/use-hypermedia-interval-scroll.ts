import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type CalendarMonth, mapMonthAfterScroll } from '../../lib/calendar-month';

const WHEEL_MONTH_DISTANCE = 160;
const MAX_WHEEL_INTERVAL_DELTA = 120;
const WHEEL_INTERVAL_SETTLE_MS = 120;
const WHEEL_INTERVAL_SNAP_THRESHOLD = 0.35;
const WHEEL_LINE_HEIGHT = 16;

type IntervalDirection = 'older' | 'newer';

function intervalDirection(progress: number): IntervalDirection {
  return progress > 0 ? 'older' : 'newer';
}

function advanceWholeMonths({
  progress,
  advance,
}: {
  progress: number;
  advance: (direction: IntervalDirection) => boolean;
}): number {
  let remaining = progress;
  while (Math.abs(remaining) >= 1) {
    const step = remaining > 0 ? 1 : -1;
    if (!advance(intervalDirection(step))) {
      return 0;
    }
    remaining -= step;
  }
  return remaining;
}

function intervalWheelDelta({
  event,
  viewportHeight,
}: {
  event: globalThis.WheelEvent;
  viewportHeight: number;
}): number {
  const pixelDelta =
    event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * WHEEL_LINE_HEIGHT
      : event.deltaMode === globalThis.WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * viewportHeight
        : event.deltaY;
  return Math.max(-MAX_WHEEL_INTERVAL_DELTA, Math.min(MAX_WHEEL_INTERVAL_DELTA, pixelDelta));
}

export function useHypermediaIntervalScroll({
  month,
  allowPagesWithoutInterval = true,
  onMonthChange,
  onIntervalScrollingChange,
}: {
  month?: CalendarMonth;
  allowPagesWithoutInterval?: boolean;
  onMonthChange: (month?: CalendarMonth) => void;
  onIntervalScrollingChange: (scrolling: boolean) => void;
}) {
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(0);
  const displayedMonthRef = useRef(month);
  const [progress, setProgress] = useState(0);
  const [displayedMonth, setDisplayedMonth] = useState(month);
  const [scrolling, setScrolling] = useState(false);

  useEffect(
    () => () => {
      if (wheelTimer.current) {
        clearTimeout(wheelTimer.current);
      }
      onIntervalScrollingChange(false);
    },
    [onIntervalScrollingChange],
  );

  useEffect(() => {
    if (month === displayedMonthRef.current) {
      return;
    }
    displayedMonthRef.current = month;
    progressRef.current = 0;
    setDisplayedMonth(month);
    setProgress(0);
  }, [month]);

  function adjacentMonth(direction: IntervalDirection): CalendarMonth | undefined {
    const nextMonth = mapMonthAfterScroll({
      month: displayedMonthRef.current,
      direction,
    });
    return !allowPagesWithoutInterval && nextMonth === undefined
      ? displayedMonthRef.current
      : nextMonth;
  }

  function updateDisplayedMonth(direction: IntervalDirection): boolean {
    const nextMonth = adjacentMonth(direction);
    if (nextMonth === displayedMonthRef.current) {
      return false;
    }
    displayedMonthRef.current = nextMonth;
    setDisplayedMonth(nextMonth);
    onMonthChange(nextMonth);
    return true;
  }

  function moveThroughMonths(nextProgress: number): number {
    const remaining = advanceWholeMonths({
      progress: nextProgress,
      advance: updateDisplayedMonth,
    });
    if (
      remaining !== 0 &&
      adjacentMonth(intervalDirection(remaining)) === displayedMonthRef.current
    ) {
      return 0;
    }
    return remaining;
  }

  function settle() {
    const currentProgress = progressRef.current;
    if (Math.abs(currentProgress) >= WHEEL_INTERVAL_SNAP_THRESHOLD) {
      updateDisplayedMonth(intervalDirection(currentProgress));
    }
    progressRef.current = 0;
    setProgress(0);
    setScrolling(false);
    onIntervalScrollingChange(false);
  }

  const handleWheel = useEffectEvent(
    ({ event, viewportHeight }: { event: globalThis.WheelEvent; viewportHeight: number }) => {
      const deltaY = intervalWheelDelta({ event, viewportHeight });
      if (deltaY === 0) {
        return;
      }
      setScrolling(true);
      onIntervalScrollingChange(true);
      if (wheelTimer.current) {
        clearTimeout(wheelTimer.current);
      }
      wheelTimer.current = setTimeout(settle, WHEEL_INTERVAL_SETTLE_MS);
      const nextProgress = moveThroughMonths(progressRef.current + deltaY / WHEEL_MONTH_DISTANCE);
      progressRef.current = nextProgress;
      setProgress(nextProgress);
    },
  );

  return { displayedMonth, handleWheel, progress, scrolling };
}
