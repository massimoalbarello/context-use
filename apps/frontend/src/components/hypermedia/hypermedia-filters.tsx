import { Search } from 'lucide-react';
import { useState } from 'react';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import { PageDateRangeFilter } from '../pages/page-date-range-filter';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

function HypermediaKeywordFilter({
  value,
  onApply,
}: {
  value: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <form
      className="grid gap-2 rounded-xl bg-muted/55 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
    >
      <label className="font-medium text-xs" htmlFor="hypermedia-keyword">
        Keyword
      </label>
      <div className="flex items-center gap-2">
        <span className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="hypermedia-keyword"
            className="h-10 pl-9"
            type="search"
            placeholder="Page, entity, or asset"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </span>
        <Button type="submit" size="sm" className="h-10 shrink-0" disabled={draft.trim() === value}>
          Apply
        </Button>
      </div>
      {(draft || value) && (
        <Button
          className="justify-self-end"
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft('');
            onApply('');
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}

export function HypermediaFilters({
  query,
  dateRange,
  onQueryApply,
  onDateRangeApply,
}: {
  query: string;
  dateRange?: CalendarDateRange;
  onQueryApply: (query: string) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
}) {
  return (
    <section aria-labelledby="hypermedia-filters-heading">
      <h2 id="hypermedia-filters-heading" className="font-medium text-sm">
        Filter hypermedia
      </h2>
      <div className="mt-2 grid gap-3">
        <HypermediaKeywordFilter key={query} value={query} onApply={onQueryApply} />
        <PageDateRangeFilter className="mb-0" value={dateRange} onApply={onDateRangeApply} />
      </div>
    </section>
  );
}
