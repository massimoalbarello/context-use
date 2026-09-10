import {
  type CalendarDateRange,
  calendarDateFromEpochDay,
  epochDayFromCalendarDate,
  temporalCoverageLabel,
} from './temporal-coverage';

const CALENDAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_DIGITS = 4;
const MONTH_DIGITS = 2;

export type CalendarMonth = `${number}-${string}`;

function calendarMonthFromUtcDate(date: Date): CalendarMonth {
  const year = String(date.getUTCFullYear()).padStart(YEAR_DIGITS, '0');
  const month = String(date.getUTCMonth() + 1).padStart(MONTH_DIGITS, '0');
  return `${year}-${month}` as CalendarMonth;
}

function dateFromCalendarMonth(value: CalendarMonth): Date {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year ?? 0, (month ?? 1) - 1, 1);
  return date;
}

export function calendarMonth(value: unknown): CalendarMonth | undefined {
  return typeof value === 'string' && CALENDAR_MONTH_PATTERN.test(value)
    ? (value as CalendarMonth)
    : undefined;
}

export function currentCalendarMonth(now = new Date()): CalendarMonth {
  const year = String(now.getFullYear()).padStart(YEAR_DIGITS, '0');
  const month = String(now.getMonth() + 1).padStart(MONTH_DIGITS, '0');
  return `${year}-${month}` as CalendarMonth;
}

export function shiftCalendarMonth({
  value,
  offset,
}: {
  value: CalendarMonth;
  offset: number;
}): CalendarMonth {
  const date = dateFromCalendarMonth(value);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return calendarMonthFromUtcDate(date);
}

export function calendarMonthRange(value: CalendarMonth): CalendarDateRange {
  const first = dateFromCalendarMonth(value);
  const after = new Date(first);
  after.setUTCMonth(after.getUTCMonth() + 1);
  after.setUTCDate(after.getUTCDate() - 1);
  return {
    from: first.toISOString().slice(0, 'YYYY-MM-DD'.length),
    to: after.toISOString().slice(0, 'YYYY-MM-DD'.length),
  };
}

export function calendarMonthFromRange(range: CalendarDateRange): CalendarMonth {
  const first = epochDayFromCalendarDate(range.from);
  const last = epochDayFromCalendarDate(range.to);
  return calendarDateFromEpochDay(Math.floor((first + last) / 2)).slice(
    0,
    'YYYY-MM'.length,
  ) as CalendarMonth;
}

export function calendarMonthLabel(value?: CalendarMonth): string {
  return value ? temporalCoverageLabel({ expression: value }) : 'Undated';
}

export function mapMonthAfterScroll({
  month,
  direction,
  now = new Date(),
}: {
  month?: CalendarMonth;
  direction: 'older' | 'newer';
  now?: Date;
}): CalendarMonth | undefined {
  const present = currentCalendarMonth(now);
  if (direction === 'older') {
    return month ? shiftCalendarMonth({ value: month, offset: -1 }) : present;
  }
  if (!month || month >= present) {
    return undefined;
  }
  return shiftCalendarMonth({ value: month, offset: 1 });
}
