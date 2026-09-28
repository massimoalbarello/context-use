import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type CalendarMonth, mapMonthAfterScroll } from '../../lib/calendar-month';

const WHEEL_MONTH_DISTANCE = 160;
const WHEEL_INTERVAL_SETTLE_MS = 120;
const WHEEL_LINE_HEIGHT = 16;

type IntervalDirection = 'older' | 'newer';

function intervalDirection(progress: number): IntervalDirection {
  return progress > 0 ? 'older' : 'newer';
}

function intervalWheelDelta({
  event,
  viewportHeight,
}: {
  event: globalThis.WheelEvent;
  viewportHeight: number;
}): number {
  return event.deltaMode === globalThis.WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * WHEEL_LINE_HEIGHT
    : event.deltaMode === globalThis.WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * viewportHeight
      : event.deltaY;
}

export function useMapIntervalScroll({
  month,
  onMonthChange,
  onIntervalScrollingChange,
}: {
  month?: CalendarMonth;
  onMonthChange: (month?: CalendarMonth) => void;
  onIntervalScrollingChange: (scrolling: boolean) => void;
}) {
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureDistanceRef = useRef(0);
  const committedMonthRef = useRef(month);
  const displayedMonthRef = useRef(month);
  const [displayedMonth, setDisplayedMonth] = useState(month);

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
    committedMonthRef.current = month;
    if (month === displayedMonthRef.current) {
      return;
    }
    displayedMonthRef.current = month;
    gestureDistanceRef.current = 0;
    setDisplayedMonth(month);
  }, [month]);

  function selectMonth(nextMonth?: CalendarMonth) {
    if (wheelTimer.current) {
      clearTimeout(wheelTimer.current);
    }
    gestureDistanceRef.current = 0;
    displayedMonthRef.current = nextMonth;
    setDisplayedMonth(nextMonth);
    if (committedMonthRef.current !== nextMonth) {
      committedMonthRef.current = nextMonth;
      onMonthChange(nextMonth);
    }
    onIntervalScrollingChange(false);
  }

  function adjacentMonth(direction: IntervalDirection): CalendarMonth | undefined {
    return mapMonthAfterScroll({
      month: displayedMonthRef.current,
      direction,
    });
  }

  function updateDisplayedMonth(direction: IntervalDirection): boolean {
    const nextMonth = adjacentMonth(direction);
    if (nextMonth === displayedMonthRef.current) {
      return false;
    }
    displayedMonthRef.current = nextMonth;
    setDisplayedMonth(nextMonth);
    return true;
  }

  function settle() {
    gestureDistanceRef.current = 0;
    if (committedMonthRef.current !== displayedMonthRef.current) {
      committedMonthRef.current = displayedMonthRef.current;
      onMonthChange(displayedMonthRef.current);
    }
    onIntervalScrollingChange(false);
  }

  const handleWheel = useEffectEvent(
    ({ event, viewportHeight }: { event: globalThis.WheelEvent; viewportHeight: number }) => {
      const deltaY = intervalWheelDelta({ event, viewportHeight });
      if (deltaY === 0 || !Number.isFinite(deltaY)) {
        return;
      }
      onIntervalScrollingChange(true);
      if (wheelTimer.current) {
        clearTimeout(wheelTimer.current);
      }
      wheelTimer.current = setTimeout(settle, WHEEL_INTERVAL_SETTLE_MS);
      const previousDistance =
        Math.sign(gestureDistanceRef.current) === Math.sign(deltaY)
          ? gestureDistanceRef.current
          : 0;
      const nextDistance = previousDistance + deltaY;
      const steps =
        Math.ceil(Math.abs(nextDistance) / WHEEL_MONTH_DISTANCE) -
        Math.ceil(Math.abs(previousDistance) / WHEEL_MONTH_DISTANCE);
      gestureDistanceRef.current = nextDistance;
      for (let step = 0; step < steps; step += 1) {
        if (!updateDisplayedMonth(intervalDirection(deltaY))) {
          break;
        }
      }
    },
  );

  return { displayedMonth, handleWheel, selectMonth };
}
