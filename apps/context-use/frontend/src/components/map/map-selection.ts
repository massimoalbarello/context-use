import type { ResourceSelection } from '../../lib/resource-selection';

export type MapSelection = {
  kind: 'page' | 'entity';
  readableId: string;
};

export function mapSelectionKey(selection: ResourceSelection): string {
  return `${selection.kind}:${selection.readableId}`;
}
