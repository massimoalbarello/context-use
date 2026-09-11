import type { DeliveredRecord } from './delivery-contract.generated.ts';

export type RecordSummary = {
  readableId: string;
  kind: string;
  recordId: string;
  sync: { readableId: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type RecordResource = RecordSummary & {
  markdown: string;
  record: Exclude<DeliveredRecord, { operation: 'deleted' }>;
};

export type RecordPage = {
  items: RecordSummary[];
  nextOffset: number | null;
};

export type RecordAcceptanceResult =
  | { state: 'accepted' }
  | { state: 'inactive_sync' }
  | { state: 'conflict' };
