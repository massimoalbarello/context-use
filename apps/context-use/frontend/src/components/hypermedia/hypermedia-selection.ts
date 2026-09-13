export type HypermediaSelection = {
  kind: 'page' | 'entity';
  readableId: string;
};

export function hypermediaSelectionKey(selection: HypermediaSelection): string {
  return `${selection.kind}:${selection.readableId}`;
}
