import { z } from 'zod';
import type { KnowledgePageSummary } from '#backend/models/knowledge-pages/model.ts';

export const MAX_RECORD_BODY_LENGTH = 2_000_000;
const MAX_SOURCE_LABEL_LENGTH = 160;
const MAX_SOURCE_ID_LENGTH = 1024;
const MAX_SOURCE_URL_LENGTH = 8192;
const MAX_RECORD_TITLE_LENGTH = 4096;
const TimestampSchema = z.iso.datetime({ offset: true });
export const RecordSourceSchema = z.strictObject({
  provider: z.string().trim().min(1).max(MAX_SOURCE_LABEL_LENGTH),
  kind: z.string().trim().min(1).max(MAX_SOURCE_LABEL_LENGTH),
  id: z.string().trim().min(1).max(MAX_SOURCE_ID_LENGTH),
  url: z
    .url({ protocol: /^https?$/ })
    .max(MAX_SOURCE_URL_LENGTH)
    .nullable()
    .default(null),
});
export const RecordInputSchema = z.strictObject({
  source: RecordSourceSchema,
  title: z.string().trim().min(1).max(MAX_RECORD_TITLE_LENGTH),
  body: z.string().max(MAX_RECORD_BODY_LENGTH),
  sourceCreatedAt: TimestampSchema.nullable().default(null),
  sourceUpdatedAt: TimestampSchema.nullable().default(null),
});
export const RecordDeletionSchema = z.strictObject({
  source: RecordSourceSchema.pick({ provider: true, kind: true, id: true }),
  sourceUpdatedAt: TimestampSchema,
});
export type RecordInput = z.input<typeof RecordInputSchema>;
export type NativeRecord = z.output<typeof RecordInputSchema>;
export type RecordDeletion = z.output<typeof RecordDeletionSchema>;
export type RecordSummary = Omit<NativeRecord, 'body'> & {
  readableId: string;
  createdAt: string;
  updatedAt: string;
};
export type RecordResource = RecordSummary & { body: string; backlinks: KnowledgePageSummary[] };
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
export type RecordSyncRevision = { syncId: string; revision: number };
export type RecordWriteResult = {
  state: 'created' | 'updated' | 'unchanged' | 'stale' | 'conflict';
  readableId: string;
};

export function parseRecord(input: RecordInput): NativeRecord {
  const record = RecordInputSchema.parse(input);
  const timestamp = (value: string | null) =>
    value === null ? null : new Date(value).toISOString();
  return {
    ...record,
    sourceCreatedAt: timestamp(record.sourceCreatedAt),
    sourceUpdatedAt: timestamp(record.sourceUpdatedAt),
  };
}
