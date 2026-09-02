import {
  InvalidTemporalCoverageError,
  parseTemporalCoverage,
  type TemporalCalendarDate,
} from '@repo/backend/temporal-coverage';

export type CalendarDateRange = { from: string; to: string };

const DATE_LABEL_REFERENCE_YEAR = 2000;
const YEAR_CHARACTER_COUNT = 4;

function calendarDateLabel({
  date,
  locales,
}: {
  date: TemporalCalendarDate;
  locales?: Intl.LocalesArgument;
}): string {
  const year = date.expression.slice(0, YEAR_CHARACTER_COUNT);
  const marker = date.marker ?? '';
  if (date.month === null) {
    return `${year}${marker}`;
  }
  const referenceDate = new Date(0);
  referenceDate.setUTCFullYear(DATE_LABEL_REFERENCE_YEAR, date.month - 1, date.day ?? 1);
  const formatter = new Intl.DateTimeFormat(locales, {
    calendar: 'gregory',
    day: date.day === null ? undefined : 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const localizedYear = new Intl.NumberFormat(locales, {
    minimumIntegerDigits: YEAR_CHARACTER_COUNT,
    useGrouping: false,
  }).format(Number(year));
  const label = formatter
    .formatToParts(referenceDate)
    .map((part) => (part.type === 'year' ? localizedYear : part.value))
    .join('');
  return `${label}${marker}`;
}

export function temporalCoverageLabel({
  expression,
  locales,
}: {
  expression: string;
  locales?: Intl.LocalesArgument;
}): string {
  const coverage = parseTemporalCoverage(expression);
  if (coverage.ongoing) {
    return `Since ${calendarDateLabel({ date: coverage.start, locales })} · ongoing`;
  }
  if (coverage.start === coverage.end) {
    return calendarDateLabel({ date: coverage.start, locales });
  }
  if (!coverage.end) {
    throw new Error('Bounded temporal coverage is missing its end date.');
  }
  return `${calendarDateLabel({ date: coverage.start, locales })} – ${calendarDateLabel({
    date: coverage.end,
    locales,
  })}`;
}

export function temporalCoverageTitle(expression: string): string {
  const markerHelp = [
    expression.includes('?') ? '? means uncertain.' : null,
    expression.includes('~') ? '~ means approximate.' : null,
  ].filter((message) => message !== null);
  return [`Interval: ${expression}.`, ...markerHelp].join(' ');
}

export function calendarDateRangeExpression({ from, to }: CalendarDateRange): string {
  const expression = `${from}/${to}`;
  parseTemporalCoverage(expression);
  return expression;
}

export function calendarDateRangeFromSearch({
  from,
  to,
}: {
  from?: unknown;
  to?: unknown;
}): CalendarDateRange | undefined {
  if (typeof from !== 'string' || typeof to !== 'string') {
    return undefined;
  }
  try {
    calendarDateRangeExpression({ from, to });
    return { from, to };
  } catch (error) {
    if (error instanceof InvalidTemporalCoverageError) {
      return undefined;
    }
    throw error;
  }
}

export function temporalCoverageMutation({
  initial,
  current,
}: {
  initial: string | null;
  current: string;
}): string | null | undefined {
  const normalized = current.trim();
  if (normalized === (initial ?? '')) {
    return undefined;
  }
  return normalized || null;
}
