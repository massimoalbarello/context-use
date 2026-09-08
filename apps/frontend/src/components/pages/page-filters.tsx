import { type KnowledgePageKind, MAX_KNOWLEDGE_PAGE_TITLE_LENGTH } from '@repo/backend/page';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { PageDateRangeFilter } from './page-date-range-filter';
import { PageTypeFilter } from './page-type-filter';

export function PageFilters({
  query,
  kind,
  dateRange,
  onQueryApply,
  onKindChange,
  onDateRangeApply,
}: {
  query: string;
  kind?: KnowledgePageKind;
  dateRange?: CalendarDateRange;
  onQueryApply: (query: string) => void;
  onKindChange: (kind?: KnowledgePageKind) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
}) {
  const filtered = Boolean(query || kind || dateRange);

  return (
    <KnowledgeFilterPopover title="Filter pages" filtered={filtered}>
      <PageTypeFilter
        value={kind ?? 'all'}
        onValueChange={(value) => onKindChange(value === 'all' ? undefined : value)}
      />
      <KeywordFilter
        key={query}
        inputId="page-keyword"
        value={query}
        placeholder="Page title"
        maxLength={MAX_KNOWLEDGE_PAGE_TITLE_LENGTH}
        autoFocus
        onApply={onQueryApply}
      />
      {kind !== 'semantic' && (
        <PageDateRangeFilter
          value={dateRange}
          hint={
            kind === 'temporal'
              ? 'Only overlapping temporal pages stay visible.'
              : 'Semantic pages stay visible.'
          }
          onApply={onDateRangeApply}
        />
      )}
    </KnowledgeFilterPopover>
  );
}
