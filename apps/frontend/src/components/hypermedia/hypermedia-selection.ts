import type { HypermediaResourceReference } from '../../queries/hypermedia';
import type { HypermediaSelection } from './hypermedia-canvas';

export function selectedHypermediaResource(
  selection?: HypermediaSelection,
): HypermediaResourceReference | undefined {
  return selection && selection.kind !== 'page'
    ? { kind: selection.kind, readableId: selection.readableId }
    : undefined;
}

export function nextHypermediaSpotlightResource({
  current,
  selection,
}: {
  current?: HypermediaResourceReference;
  selection?: HypermediaSelection;
}): HypermediaResourceReference | undefined {
  return (
    selectedHypermediaResource(selection) ?? (selection?.kind === 'page' ? current : undefined)
  );
}
