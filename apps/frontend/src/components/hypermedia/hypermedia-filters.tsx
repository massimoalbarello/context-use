import { Search, X } from 'lucide-react';
import { useState } from 'react';
import type { CalendarDateRange } from '../../lib/temporal-coverage';
import type { HypermediaResourceReference } from '../../queries/hypermedia';
import { PageDateRangeFilter } from '../pages/page-date-range-filter';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { selectedHypermediaResourcesLabel } from './hypermedia-selection';

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
  selectedResources,
  onQueryApply,
  onDateRangeApply,
  onClearSelectedResources,
}: {
  query: string;
  dateRange?: CalendarDateRange;
  selectedResources: HypermediaResourceReference[];
  onQueryApply: (query: string) => void;
  onDateRangeApply: (dateRange?: CalendarDateRange) => void;
  onClearSelectedResources: () => void;
}) {
  return (
    <section aria-labelledby="hypermedia-filters-heading">
      <h2 id="hypermedia-filters-heading" className="font-medium text-sm">
        Filter hypermedia
      </h2>
      <div className="mt-2 grid gap-3">
        {selectedResources.length > 0 && (
          <div className="flex items-center gap-3 rounded-xl bg-muted/55 p-3" aria-live="polite">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">
                {selectedHypermediaResourcesLabel(selectedResources)}
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">Pages include every selection.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              aria-label="Clear selected resources"
              onClick={onClearSelectedResources}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        <HypermediaKeywordFilter key={query} value={query} onApply={onQueryApply} />
        <PageDateRangeFilter className="mb-0" value={dateRange} onApply={onDateRangeApply} />
      </div>
    </section>
  );
}
