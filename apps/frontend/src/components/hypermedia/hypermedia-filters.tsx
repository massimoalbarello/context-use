import { Check, X } from 'lucide-react';
import type { HypermediaResourceReference, HypermediaView } from '../../queries/hypermedia';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { Button } from '../ui/button';
import type { HypermediaResourceKind } from './hypermedia-resource-filter';
import { selectedHypermediaResourcesLabel } from './hypermedia-selection';
import { HypermediaViewFilter } from './hypermedia-view-filter';

export function HypermediaFilters({
  view,
  resourceKinds,
  query,
  selectedResources,
  onViewChange,
  onResourceKindToggle,
  onQueryApply,
  onClearSelectedResources,
}: {
  view: HypermediaView;
  resourceKinds: HypermediaResourceKind[];
  query: string;
  selectedResources: HypermediaResourceReference[];
  onViewChange: (view: HypermediaView) => void;
  onResourceKindToggle: (kind: HypermediaResourceKind) => void;
  onQueryApply: (query: string) => void;
  onClearSelectedResources: () => void;
}) {
  return (
    <section aria-labelledby="hypermedia-filters-heading">
      <h2 id="hypermedia-filters-heading" className="font-medium text-sm">
        Explore hypermedia
      </h2>
      <div className="mt-2 grid gap-3">
        <HypermediaViewFilter value={view} onValueChange={onViewChange} />
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
        <KeywordFilter
          key={query}
          inputId="hypermedia-keyword"
          value={query}
          placeholder="Page, entity, or asset"
          onApply={onQueryApply}
        />
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
