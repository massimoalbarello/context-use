import { X } from 'lucide-react';
import type { HypermediaEntityReference } from '../../queries/hypermedia';
import { KeywordFilter } from '../knowledge/keyword-filter';
import { Button } from '../ui/button';
import { selectedHypermediaEntitiesLabel } from './hypermedia-selection';

export function HypermediaFilters({
  query,
  selectedEntities,
  onQueryApply,
  onClearSelectedEntities,
}: {
  query: string;
  selectedEntities: HypermediaEntityReference[];
  onQueryApply: (query: string) => void;
  onClearSelectedEntities: () => void;
}) {
  return (
    <div className="grid gap-3">
      <KeywordFilter
        key={query}
        inputId="hypermedia-keyword"
        value={query}
        placeholder="Page or entity"
        onApply={onQueryApply}
      />
      {selectedEntities.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-muted/55 p-3" aria-live="polite">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">
              {selectedHypermediaEntitiesLabel(selectedEntities)}
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs">Pages include every selection.</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full"
            aria-label="Clear selected entities"
            onClick={onClearSelectedEntities}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
