export const MAX_CHANGE_MESSAGE_LENGTH = 280;

export type ChangeActor =
  | { kind: 'owner' }
  | { kind: 'mcp_client'; clientAuthorizationId: string; name: string }
  | { kind: 'sync'; name: string }
  | { kind: 'api_key'; keyId: string; name: string };

export type ChangeContext = { actor: ChangeActor; message: string };

export type ResourceChange = {
  sequence: number;
  resourceType: 'entity' | 'page' | 'asset' | 'record';
  readableId: string;
  name: string;
  action: 'created' | 'updated' | 'archived' | 'deleted';
  message: string;
  author: { kind: ChangeActor['kind']; name: string };
  details: string[];
  revisionNumber: number | null;
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
