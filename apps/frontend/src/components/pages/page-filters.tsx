import {
  type KnowledgePageIntervalFilter,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '@repo/backend/page';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { DateRangeFilter } from '../knowledge/date-range-filter';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { PageIntervalFilter } from './page-interval-filter';

export function PageFilters({
  query,
  interval,
  dateRange,
  onQueryApply,
  onIntervalChange,
  onDateRangeApply,
}: {
  query: string;
  interval?: KnowledgePageIntervalFilter;
  dateRange?: CalendarDateRange;
  onQueryApply: (query: string) => void;
  onIntervalChange: (interval?: KnowledgePageIntervalFilter) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
}) {
  const filtered = Boolean(query || interval || dateRange);

  return (
    <KnowledgeFilterPopover title="Filter pages" filtered={filtered}>
      <PageIntervalFilter
        value={interval ?? 'all'}
        onValueChange={(value) => onIntervalChange(value === 'all' ? undefined : value)}
      />
      <KeywordFilter
        key={query}
        inputId="page-keyword"
        value={query}
        placeholder="Page title"
        maxLength={MAX_KNOWLEDGE_PAGE_TITLE_LENGTH}
        onApply={onQueryApply}
      />
      {interval !== 'without' && (
        <DateRangeFilter
          value={dateRange}
          hint="Pages without an interval are excluded."
          onApply={onDateRangeApply}
        />
      )}
    </KnowledgeFilterPopover>
  );
}
