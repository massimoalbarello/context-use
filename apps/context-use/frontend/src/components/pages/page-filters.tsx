import type { KnowledgePageIntervalFilter } from '#backend/models/knowledge-pages/model.ts';
import type { PublicationVisibility } from '#backend/models/publications/model.ts';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { DateRangeFilter } from '../knowledge/date-range-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { PublicationVisibilityFilter } from '../publications/publication-visibility-filter';
import { PageIntervalFilter } from './page-interval-filter';

export function PageFilters({
  interval,
  dateRange,
  visibility,
  onIntervalChange,
  onDateRangeApply,
  onVisibilityChange,
}: {
  interval?: KnowledgePageIntervalFilter;
  dateRange?: CalendarDateRange;
  visibility?: PublicationVisibility;
  onIntervalChange: (interval?: KnowledgePageIntervalFilter) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  onVisibilityChange: (visibility?: PublicationVisibility) => void;
}) {
  const filtered = Boolean(interval || dateRange || visibility);

  return (
    <KnowledgeFilterPopover title="Filter pages" filtered={filtered}>
      <PublicationVisibilityFilter value={visibility} onChange={onVisibilityChange} />
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
