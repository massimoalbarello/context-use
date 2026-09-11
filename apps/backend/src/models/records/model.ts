import type { DeliveredRecord } from './delivery-contract.generated.ts';

export type RecordSummary = {
  readableId: string;
  title: string;
  provider: string;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
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

export const RECORD_SORT_FIELDS = [
  'sourceCreatedAt',
  'sourceUpdatedAt',
  'provider',
  'kind',
] as const;
export type RecordSortField = (typeof RECORD_SORT_FIELDS)[number];

export type RecordListFilters = {
  provider?: string;
  kind?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  sortBy?: RecordSortField;
  sortDirection?: 'asc' | 'desc';
};

export type RecordFilterOptions = { providers: string[]; kinds: string[] };

export type StoredRecord = RecordSummary & {
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
};

export type RecordPage = {
  filterOptions: RecordFilterOptions;
  items: RecordSummary[];
  nextOffset: number | null;
};

export type RecordAcceptanceResult =
  | { state: 'accepted' }
  | { state: 'inactive_sync' }
  | { state: 'conflict' };
