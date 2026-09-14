import type { KnowledgePageIntervalFilter } from '#backend/models/knowledge-pages/model.ts';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { DateRangeFilter } from '../knowledge/date-range-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { PageIntervalFilter } from './page-interval-filter';

export function PageFilters({
  interval,
  dateRange,
  onIntervalChange,
  onDateRangeApply,
}: {
  interval?: KnowledgePageIntervalFilter;
  dateRange?: CalendarDateRange;
  onIntervalChange: (interval?: KnowledgePageIntervalFilter) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
}) {
  const filtered = Boolean(interval || dateRange);

  return (
    <KnowledgeFilterPopover title="Filter pages" filtered={filtered}>
      <PageIntervalFilter
        value={interval ?? 'all'}
        onValueChange={(value) => onIntervalChange(value === 'all' ? undefined : value)}
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
