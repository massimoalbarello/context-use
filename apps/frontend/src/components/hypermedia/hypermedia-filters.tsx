import { Check, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  HypermediaPageProjection,
  HypermediaResourceReference,
} from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import type { HypermediaResourceKind } from './hypermedia-resource-filter';
import { selectedHypermediaResourcesLabel } from './hypermedia-selection';

function HypermediaKeywordFilter({
  value,
  onApply,
}: {
  value: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusKeywordInput(event: KeyboardEvent) {
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
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    window.addEventListener('keydown', focusKeywordInput);
    return () => window.removeEventListener('keydown', focusKeywordInput);
  }, []);

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
            ref={inputRef}
            id="hypermedia-keyword"
            className="h-10 pl-9"
            type="search"
            aria-keyshortcuts="Meta+K"
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
  projection,
  resourceKinds,
  query,
  selectedResources,
  onProjectionChange,
  onResourceKindToggle,
  onQueryApply,
  onClearSelectedResources,
}: {
  projection: HypermediaPageProjection;
  resourceKinds: HypermediaResourceKind[];
  query: string;
  selectedResources: HypermediaResourceReference[];
  onProjectionChange: (projection: HypermediaPageProjection) => void;
  onResourceKindToggle: (kind: HypermediaResourceKind) => void;
  onQueryApply: (query: string) => void;
  onClearSelectedResources: () => void;
}) {
  return (
    <section aria-labelledby="hypermedia-filters-heading">
      <h2 id="hypermedia-filters-heading" className="font-medium text-sm">
        Filter hypermedia
      </h2>
      <div className="mt-2 grid gap-3">
        <Tabs value={projection} onValueChange={onProjectionChange}>
          <TabsList className="grid w-full grid-cols-2" aria-label="Hypermedia projection">
            <TabsTrigger value="semantic">Semantic</TabsTrigger>
            <TabsTrigger value="temporal">Temporal</TabsTrigger>
          </TabsList>
        </Tabs>
        <fieldset className="grid gap-2" aria-label="Hypermedia resource types">
          <legend className="font-medium text-xs">Visualize</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { kind: 'entity', label: 'Entities' },
                { kind: 'asset', label: 'Assets' },
              ] as const
            ).map(({ kind, label }) => {
              const selected = resourceKinds.includes(kind);
              return (
                <Button
                  key={kind}
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                  className="h-9 justify-start px-3"
                  aria-pressed={selected}
                  onClick={() => onResourceKindToggle(kind)}
                >
                  <span
                    className="grid size-4 place-items-center rounded-sm border border-current"
                    aria-hidden="true"
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="sr-only">Select one or both resource types to visualize.</p>
        </fieldset>
        <HypermediaKeywordFilter key={query} value={query} onApply={onQueryApply} />
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
      </div>
    </section>
  );
}
