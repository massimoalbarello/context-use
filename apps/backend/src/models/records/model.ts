import type { KnowledgePageSummary } from '#models/knowledge-pages/model.ts';
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
  backlinks: KnowledgePageSummary[];
  record: Exclude<DeliveredRecord, { operation: 'deleted' }>;
};

export function recordParticipantNames(record: RecordResource['record']): string[] {
  return [
    ...new Set(
      record.content.participants?.flatMap(({ name }) => (name?.trim() ? [name.trim()] : [])) ?? [],
    ),
  ];
}

export const RECORD_SORT_FIELDS = ['sourceCreatedAt', 'sourceUpdatedAt'] as const;
export type RecordSortField = (typeof RECORD_SORT_FIELDS)[number];

export type RecordSourceFilters = {
  provider?: string;
  kind?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type RecordListFilters = RecordSourceFilters & {
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
