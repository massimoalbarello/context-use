export const MAX_TEMPORAL_COVERAGE_LENGTH = 23;

const MONTHS_PER_YEAR = 12;

const DATE_PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([?~])?$/;

const TEMPORAL_COVERAGE_FORMAT =
  'Use YYYY, YYYY-MM, or YYYY-MM-DD; append ? for uncertain or ~ for approximate, join two dates with / for a bounded interval, or use start/.. for an evidenced ongoing interval.';

export type TemporalBounds = { start: number; end: number | null };

export type TemporalCalendarDate = {
  expression: string;
  year: number;
  month: number | null;
  day: number | null;
  marker: '?' | '~' | null;
  bounds: { start: number; end: number };
};

export type ParsedTemporalCoverage = {
  expression: string;
  start: TemporalCalendarDate;
  end: TemporalCalendarDate | null;
  ongoing: boolean;
  bounds: TemporalBounds;
};

export class InvalidTemporalCoverageError extends Error {
  constructor(message = TEMPORAL_COVERAGE_FORMAT) {
    super(message);
    this.name = 'InvalidTemporalCoverageError';
  }
}

function utcDate({ year, month, day }: { year: number; month: number; day: number }): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function calendarDateFrom(expression: string): TemporalCalendarDate | null {
  const match = DATE_PATTERN.exec(expression);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  const resolvedMonth = month ?? 1;
  const resolvedDay = day ?? 1;
  const earliestDate = utcDate({ year, month: resolvedMonth, day: resolvedDay });
  if (
    resolvedMonth < 1 ||
    resolvedMonth > MONTHS_PER_YEAR ||
    resolvedDay < 1 ||
    earliestDate.getUTCFullYear() !== year ||
    earliestDate.getUTCMonth() !== resolvedMonth - 1 ||
    earliestDate.getUTCDate() !== resolvedDay
  ) {
    throw new InvalidTemporalCoverageError();
  }

  const after = new Date(earliestDate);
  if (day !== null) {
    after.setUTCDate(after.getUTCDate() + 1);
  } else if (month !== null) {
    after.setUTCMonth(after.getUTCMonth() + 1);
  } else {
    after.setUTCFullYear(after.getUTCFullYear() + 1);
  }
  return {
    expression,
    year,
    month,
    day,
    marker: (match[4] as '?' | '~' | undefined) ?? null,
    bounds: { start: earliestDate.getTime(), end: after.getTime() },
  };
}

function calendarDate(expression: string): TemporalCalendarDate {
  const date = calendarDateFrom(expression);
  if (!date) {
    throw new InvalidTemporalCoverageError();
  }
  return date;
}

export function temporalCoverageFrom(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  temporalBoundsFrom(value);
  return value;
}

export function temporalBoundsFrom(value: string): TemporalBounds {
  return parseTemporalCoverage(value).bounds;
}

export function parseTemporalCoverage(value: string): ParsedTemporalCoverage {
  if (value.length === 0 || value.length > MAX_TEMPORAL_COVERAGE_LENGTH || value.trim() !== value) {
    throw new InvalidTemporalCoverageError();
  }

  const interval = value.split('/');
  if (interval.length === 1) {
    const point = calendarDate(value);
    return {
      expression: value,
      start: point,
      end: point,
      ongoing: false,
      bounds: point.bounds,
    };
  }
  if (interval.length !== 2) {
    throw new InvalidTemporalCoverageError();
  }
  const [start, end] = interval;
  if (!start || !end || start === '..') {
    throw new InvalidTemporalCoverageError();
  }
  const startDate = calendarDate(start);
  const endDate = end === '..' ? null : calendarDate(end);
  if (endDate && startDate.bounds.start >= endDate.bounds.end) {
    throw new InvalidTemporalCoverageError('Temporal coverage must not end before it starts.');
  }
  return {
    expression: value,
    start: startDate,
    end: endDate,
    ongoing: endDate === null,
    bounds: { start: startDate.bounds.start, end: endDate?.bounds.end ?? null },
  };
}
