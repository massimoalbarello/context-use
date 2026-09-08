import { type KnowledgePageKind, MAX_KNOWLEDGE_PAGE_TITLE_LENGTH } from '@repo/backend/page';
import { ListFilter } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
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
  const [open, setOpen] = useState(false);
  const filtered = Boolean(query || kind || dateRange);

  useEffect(() => {
    function openKeywordFilter(event: KeyboardEvent) {
      if (
        event.key.toLocaleLowerCase() !== 'k' ||
        !event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener('keydown', openKeywordFilter);
    return () => window.removeEventListener('keydown', openKeywordFilter);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            variant={filtered ? 'secondary' : 'outline'}
            aria-label="Filter pages"
            title="Filter pages"
          />
        }
      >
        <ListFilter aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <section aria-labelledby="page-filters-heading">
          <h2 id="page-filters-heading" className="font-medium text-sm">
            Filter pages
          </h2>
          <div className="mt-3 grid gap-3">
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
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
