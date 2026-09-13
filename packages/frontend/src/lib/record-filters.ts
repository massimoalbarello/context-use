import { RECORD_SORT_FIELDS, type RecordSortField } from '@repo/backend/record';
import { MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH } from '@repo/backend/retrieval';
import type { RecordCollectionFilters } from '../queries/records';
import {
  type CalendarDateRange,
  calendarDateRangeFromSearch,
  epochDayFromCalendarDate,
} from './temporal-coverage';

export type RecordSearch = {
  q?: string;
  provider?: string;
  kind?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sortBy?: RecordSortField;
  sortDirection?: 'asc' | 'desc';
};

export function recordSearch(search: Record<string, unknown>): RecordSearch {
  const result: RecordSearch = {};
  if (typeof search.q === 'string' && search.q.trim()) {
    result.q = search.q.trim().slice(0, MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH);
  }
  for (const field of ['provider', 'kind'] as const) {
    if (typeof search[field] === 'string' && search[field].trim()) {
      result[field] = search[field].trim();
    }
  }
  if (RECORD_SORT_FIELDS.some((field) => field === search.sortBy)) {
    result.sortBy = search.sortBy as RecordSortField;
  }
  if (search.sortDirection === 'asc' || search.sortDirection === 'desc') {
    result.sortDirection = search.sortDirection;
  }
  const created = calendarDateRangeFromSearch({ from: search.createdFrom, to: search.createdTo });
  const updated = calendarDateRangeFromSearch({ from: search.updatedFrom, to: search.updatedTo });
  if (created) {
    result.createdFrom = created.from;
    result.createdTo = created.to;
  }
  if (updated) {
    result.updatedFrom = updated.from;
    result.updatedTo = updated.to;
  }
  return result;
}

/** Calendar filters include both selected days in UTC; the API upper bound is exclusive. */
function bounds(range?: CalendarDateRange): { from?: string; to?: string } {
  if (!range) {
    return {};
  }
  const dayMilliseconds = 86_400_000;
  return {
    from: new Date(epochDayFromCalendarDate(range.from) * dayMilliseconds).toISOString(),
    to: new Date((epochDayFromCalendarDate(range.to) + 1) * dayMilliseconds).toISOString(),
  };
}

export function recordListFilters(search: RecordSearch): RecordCollectionFilters {
  const created = bounds(
    calendarDateRangeFromSearch({ from: search.createdFrom, to: search.createdTo }),
  );
  const updated = bounds(
    calendarDateRangeFromSearch({ from: search.updatedFrom, to: search.updatedTo }),
  );
  return {
    query: search.q,
    provider: search.provider,
    kind: search.kind,
    createdFrom: created.from,
    createdTo: created.to,
    updatedFrom: updated.from,
    updatedTo: updated.to,
    sortBy: search.sortBy ?? 'sourceUpdatedAt',
    sortDirection: search.sortDirection ?? 'desc',
  };
}

export function recordsAreFiltered(search: RecordSearch): boolean {
  return Boolean(
    search.q || search.provider || search.kind || search.createdFrom || search.updatedFrom,
  );
}
