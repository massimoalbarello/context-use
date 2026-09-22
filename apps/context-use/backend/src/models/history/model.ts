export const MAX_CHANGE_MESSAGE_LENGTH = 280;

export type ChangeContext = { clientName: string | null; message: string };

export type ResourceChange = {
  sequence: number;
  resourceType: 'entity' | 'page' | 'asset' | 'record';
  readableId: string;
  name: string;
  action: 'created' | 'updated' | 'archived' | 'deleted';
  message: string;
  clientName: string | null;
  details: string[];
  pageRevisionNumber: number | null;
  createdAt: string;
  available: boolean;
};

export function changedText({
  label,
  before,
  after,
}: {
  label: string;
  before: string | null;
  after: string | null;
}): string[] {
  return before === after
    ? []
    : [`${label}: ${before ? `“${before}”` : 'none'} → ${after ? `“${after}”` : 'none'}`];
}
