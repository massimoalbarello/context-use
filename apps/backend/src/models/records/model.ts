export type RecordIdentity = {
  syncId: string;
  sourceId: string;
  kind: string;
  recordId: string;
};

export type RecordSummary = {
  readableId: string;
  sourceId: string;
  kind: string;
  recordId: string;
  sync: { readableId: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type RecordResource = RecordSummary & {
  markdown: string;
};

export type RecordPage = {
  items: RecordSummary[];
  nextOffset: number | null;
};

export type RecordAcceptanceResult =
  | { state: 'accepted' }
  | { state: 'inactive_sync' }
  | { state: 'conflict'; reason: 'record_revision' };
