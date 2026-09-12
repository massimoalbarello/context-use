import { X } from 'lucide-react';
import type { HypermediaEntityReference } from '../../queries/hypermedia';
import { Button } from '../ui/button';
import { selectedHypermediaEntitiesLabel } from './hypermedia-selection';

export function HypermediaFilters({
  selectedEntities,
  onClearSelectedEntities,
}: {
  selectedEntities: HypermediaEntityReference[];
  onClearSelectedEntities: () => void;
}) {
  if (selectedEntities.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/55 p-3" aria-live="polite">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{selectedHypermediaEntitiesLabel(selectedEntities)}</p>
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
  );
}
