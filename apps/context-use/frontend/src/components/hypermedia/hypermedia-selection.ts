import type { ResourceSelection } from '../../lib/resource-selection';

export type HypermediaSelection = {
  kind: 'page' | 'entity';
  readableId: string;
};

export function hypermediaSelectionKey(selection: ResourceSelection): string {
  return `${selection.kind}:${selection.readableId}`;
}
