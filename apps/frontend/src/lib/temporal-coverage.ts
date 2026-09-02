import { parseTemporalCoverage, type TemporalCalendarDate } from '@repo/backend/temporal-coverage';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const YEAR_CHARACTER_COUNT = 4;

function calendarDateLabel(date: TemporalCalendarDate): string {
  const year = date.expression.slice(0, YEAR_CHARACTER_COUNT);
  const marker = date.marker ?? '';
  if (date.month === null) {
    return `${year}${marker}`;
  }
  const month = MONTH_NAMES[date.month - 1];
  if (date.day === null) {
    return `${month} ${year}${marker}`;
  }
  return `${month} ${date.day}, ${year}${marker}`;
}

export function temporalCoverageLabel(expression: string): string {
  const coverage = parseTemporalCoverage(expression);
  if (coverage.ongoing) {
    return `Since ${calendarDateLabel(coverage.start)} · ongoing`;
  }
  if (coverage.start === coverage.end) {
    return calendarDateLabel(coverage.start);
  }
  if (!coverage.end) {
    throw new Error('Bounded temporal coverage is missing its end date.');
  }
  return `${calendarDateLabel(coverage.start)} – ${calendarDateLabel(coverage.end)}`;
}

export function temporalCoverageTitle(expression: string): string {
  const markerHelp = `${expression.includes('?') ? ' ? means uncertain.' : ''}${
    expression.includes('~') ? ' ~ means approximate.' : ''
  }`;
  return `Subject time stored as ${expression}.${markerHelp}`;
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
