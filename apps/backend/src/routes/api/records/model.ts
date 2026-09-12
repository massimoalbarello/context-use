import { t } from 'elysia';
import {
  RECORD_SORT_FIELDS,
  type RecordResource,
  type RecordSummary,
  recordParticipantNames,
} from '#models/records/model.ts';
import { MAX_SYNC_NAME_LENGTH } from '#models/syncs/model.ts';
import { AssetSummarySchema, assetSummaryResponse } from '#routes/api/assets/summary-model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#routes/api/model.ts';
import { KnowledgePageSummarySchema, pageSummaryResponse } from '#routes/api/pages/model.ts';

export const RecordSyncReferenceSchema = t.Object({
  readableId: ReadableIdSchema,
  name: t.String({ minLength: 1, maxLength: MAX_SYNC_NAME_LENGTH }),
});

export const RecordSummarySchema = t.Object({
  readableId: ReadableIdSchema,
  title: t.String({ minLength: 1 }),
  provider: t.String({ minLength: 1 }),
  sourceCreatedAt: t.Nullable(t.String({ format: 'date-time' })),
  sourceUpdatedAt: t.Nullable(t.String({ format: 'date-time' })),
  kind: t.String({ minLength: 1 }),
  recordId: t.String({ minLength: 1 }),
  sync: RecordSyncReferenceSchema,
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const RecordSchema = t.Object({
  ...RecordSummarySchema.properties,
  markdown: t.String({ minLength: 1 }),
  participantNames: t.Array(t.String()),
  backlinks: t.Array(KnowledgePageSummarySchema),
  assets: t.Array(AssetSummarySchema),
});

export const RecordFilterOptionsSchema = t.Object({
  providers: t.Array(t.String()),
  kinds: t.Array(t.String()),
});

export const RecordListSchema = t.Object({
  filterOptions: RecordFilterOptionsSchema,
  items: t.Array(RecordSummarySchema),
  nextOffset: t.Nullable(t.Integer({ minimum: 0 })),
});

export const RecordListQuerySchema = t.Object({
  ...PaginationQuerySchema.properties,
  provider: t.Optional(t.String({ minLength: 1, maxLength: 1024, pattern: '\\S' })),
  kind: t.Optional(t.String({ minLength: 1, maxLength: 1024, pattern: '\\S' })),
  createdFrom: t.Optional(t.Date()),
  createdTo: t.Optional(t.Date()),
  updatedFrom: t.Optional(t.Date()),
  updatedTo: t.Optional(t.Date()),
  sortBy: t.Optional(t.Union(RECORD_SORT_FIELDS.map((field) => t.Literal(field)))),
  sortDirection: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});
export const RecordParamsSchema = t.Object({ recordReadableId: ReadableIdSchema });

export function invalidRecordDateRange({ from, to }: { from?: Date; to?: Date }): boolean {
  return from !== undefined && to !== undefined && from >= to;
}

export function recordSummaryResponse(record: RecordSummary) {
  return {
    readableId: record.readableId,
    title: record.title,
    provider: record.provider,
    sourceCreatedAt: record.sourceCreatedAt,
    sourceUpdatedAt: record.sourceUpdatedAt,
    kind: record.kind,
    recordId: record.recordId,
    sync: record.sync,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function recordResponse(record: RecordResource) {
  return {
    ...recordSummaryResponse(record),
    markdown: record.markdown,
    participantNames: recordParticipantNames(record.record),
    backlinks: record.backlinks.map(pageSummaryResponse),
    assets: record.assets.map(assetSummaryResponse),
  };
}
