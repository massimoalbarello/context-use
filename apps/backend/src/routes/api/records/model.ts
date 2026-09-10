import { t } from 'elysia';
import type { RecordResource, RecordSummary } from '#models/records/model.ts';
import { MAX_SYNC_NAME_LENGTH } from '#models/syncs/model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#routes/api/model.ts';

export const RecordSyncReferenceSchema = t.Object({
  readableId: ReadableIdSchema,
  name: t.String({ minLength: 1, maxLength: MAX_SYNC_NAME_LENGTH }),
});

export const RecordSummarySchema = t.Object({
  readableId: ReadableIdSchema,
  sourceId: t.String({ minLength: 1 }),
  kind: t.String({ minLength: 1 }),
  recordId: t.String({ minLength: 1 }),
  sync: RecordSyncReferenceSchema,
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const RecordSchema = t.Object({
  ...RecordSummarySchema.properties,
  markdown: t.String({ minLength: 1 }),
});

export const RecordListSchema = t.Object({
  items: t.Array(RecordSummarySchema),
  nextOffset: t.Nullable(t.Integer({ minimum: 0 })),
});

export const RecordListQuerySchema = t.Object({ ...PaginationQuerySchema.properties });
export const RecordParamsSchema = t.Object({ recordReadableId: ReadableIdSchema });

export function recordSummaryResponse(record: RecordSummary) {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function recordResponse(record: RecordResource) {
  return { ...recordSummaryResponse(record), markdown: record.markdown };
}
