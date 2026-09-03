import {
  type CalendarDateRange,
  calendarDateRangeExpression,
  type TransportedTemporalCoverage,
  temporalCoverageRecency,
} from '../../lib/temporal-coverage';

const DAYS_PER_YEAR = 365.2425;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_YEAR =
  DAYS_PER_YEAR * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const TEMPORAL_EMPHASIS_FLOOR = 0.5;
const TEMPORAL_FADE_YEARS = 5;

export type HypermediaPageAppearance = {
  kind: 'semantic' | 'temporal';
  emphasis: number;
};

function distanceFromReference({
  coverage,
  dateRange,
  referenceTime,
}: {
  coverage: TransportedTemporalCoverage;
  dateRange?: CalendarDateRange;
  referenceTime: number;
}): number {
  const page = temporalCoverageRecency(coverage);
  const reference = dateRange
    ? temporalCoverageRecency(calendarDateRangeExpression(dateRange))
    : { start: referenceTime, latest: referenceTime };
  const pageEnd = page.ongoing ? Number.POSITIVE_INFINITY : page.latest;

  if (pageEnd < reference.start) {
    return reference.start - pageEnd;
  }
  if (page.start > reference.latest) {
    return page.start - reference.latest;
  }
  return 0;
}

export function hypermediaPageAppearance({
  temporalCoverage,
  dateRange,
  referenceTime = Date.now(),
}: {
  temporalCoverage: TransportedTemporalCoverage | null;
  dateRange?: CalendarDateRange;
  referenceTime?: number;
}): HypermediaPageAppearance {
  if (temporalCoverage === null) {
    return { kind: 'semantic', emphasis: 1 };
  }
  const distanceYears =
    distanceFromReference({ coverage: temporalCoverage, dateRange, referenceTime }) /
    MILLISECONDS_PER_YEAR;
  return {
    kind: 'temporal',
    emphasis:
      TEMPORAL_EMPHASIS_FLOOR +
      (1 - TEMPORAL_EMPHASIS_FLOOR) * Math.exp(-distanceYears / TEMPORAL_FADE_YEARS),
  };
}
