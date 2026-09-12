import type { RecordFilterOptions, RecordSortField } from '@repo/backend/record';
import { MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH } from '@repo/backend/retrieval';
import type { ReactNode } from 'react';
import { type RecordSearch, recordsAreFiltered } from '../../lib/record-filters';
import { calendarDateRangeFromSearch } from '../../lib/temporal-coverage';
import { DateRangeFilter } from '../knowledge/date-range-filter';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const sortLabels: Record<RecordSortField, string> = {
  sourceUpdatedAt: 'Source updated',
  sourceCreatedAt: 'Source created',
};

function FilterSelect({
  label,
  value,
  selectedLabel,
  children,
  onChange,
}: {
  label: string;
  value: string | null;
  selectedLabel?: string;
  children: ReactNode;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="font-medium text-xs">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full min-w-0" aria-label={label}>
          <SelectValue placeholder={`All ${label === 'Provider' ? 'providers' : 'kinds'}`}>
            {selectedLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export function RecordFilters({
  search,
  options,
  onChange,
}: {
  search: RecordSearch;
  options: RecordFilterOptions;
  onChange: (search: RecordSearch) => void;
}) {
  const created = calendarDateRangeFromSearch({ from: search.createdFrom, to: search.createdTo });
  const updated = calendarDateRangeFromSearch({ from: search.updatedFrom, to: search.updatedTo });
  const sortBy = search.sortBy ?? 'sourceUpdatedAt';
  return (
    <KnowledgeFilterPopover title="Filter and sort records" filtered={recordsAreFiltered(search)}>
      <KeywordFilter
        key={search.q ?? ''}
        inputId="record-keyword"
        value={search.q ?? ''}
        placeholder="Search records"
        maxLength={MAX_HYPERMEDIA_SEARCH_QUERY_LENGTH}
        onApply={(query) => onChange({ ...search, q: query || undefined })}
      />
      <FilterSelect
        label="Provider"
        value={search.provider ?? null}
        onChange={(provider) => onChange({ ...search, provider: provider ?? undefined })}
      >
        <SelectItem value={null}>All providers</SelectItem>
        {[...new Set([...options.providers, ...(search.provider ? [search.provider] : [])])].map(
          (provider) => (
            <SelectItem key={provider} value={provider}>
              {provider}
            </SelectItem>
          ),
        )}
      </FilterSelect>
      <FilterSelect
        label="Data kind"
        value={search.kind ?? null}
        onChange={(kind) => onChange({ ...search, kind: kind ?? undefined })}
      >
        <SelectItem value={null}>All kinds</SelectItem>
        {[...new Set([...options.kinds, ...(search.kind ? [search.kind] : [])])].map((kind) => (
          <SelectItem key={kind} value={kind}>
            {kind}
          </SelectItem>
        ))}
      </FilterSelect>
      {search.q ? (
        <p className="text-muted-foreground text-xs">Ordered by relevance.</p>
      ) : (
        <div className="grid gap-3">
          <FilterSelect
            label="Order by"
            value={sortBy}
            selectedLabel={sortLabels[sortBy]}
            onChange={(value) => {
              if (value) {
                onChange({ ...search, sortBy: value as RecordSortField });
              }
            }}
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Direction"
            value={search.sortDirection ?? 'desc'}
            selectedLabel={search.sortDirection === 'asc' ? 'Oldest first' : 'Newest first'}
            onChange={(value) => {
              if (value === 'asc' || value === 'desc') {
                onChange({ ...search, sortDirection: value });
              }
            }}
          >
            <SelectItem value="desc">Newest first</SelectItem>
            <SelectItem value="asc">Oldest first</SelectItem>
          </FilterSelect>
        </div>
      )}
      <DateRangeFilter
        title="Source created"
        value={created}
        hint={null}
        onApply={(range) => onChange({ ...search, createdFrom: range?.from, createdTo: range?.to })}
      />
      <DateRangeFilter
        title="Source updated"
        value={updated}
        hint={null}
        onApply={(range) => onChange({ ...search, updatedFrom: range?.from, updatedTo: range?.to })}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
        Reset filters and order
      </Button>
    </KnowledgeFilterPopover>
  );
}
