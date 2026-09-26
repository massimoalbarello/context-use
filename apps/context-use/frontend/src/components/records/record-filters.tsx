import { Button } from '@repo/ui/button';
import type { ReactNode } from 'react';
import type { RecordFilterOptions } from '#backend/models/records/model.ts';
import { type RecordSearch, recordsAreFiltered } from '../../lib/record-filters';
import { calendarDateRangeFromSearch } from '../../lib/temporal-coverage';
import { DateRangeFilter } from '../knowledge/date-range-filter';
import { KnowledgeFilterPopover } from '../knowledge/knowledge-filter-popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

function FilterSelect({
  label,
  value,
  children,
  onChange,
}: {
  label: string;
  value: string | null;
  children: ReactNode;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="font-medium text-xs">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full min-w-0" aria-label={label}>
          <SelectValue placeholder={`All ${label === 'Provider' ? 'providers' : 'kinds'}`} />
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
  return (
    <KnowledgeFilterPopover
      title="Filter records"
      filtered={recordsAreFiltered({ ...search, q: undefined })}
    >
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
      {search.q && <p className="text-muted-foreground text-xs">Ordered by relevance.</p>}
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
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ q: search.q })}>
        Reset filters
      </Button>
    </KnowledgeFilterPopover>
  );
}
