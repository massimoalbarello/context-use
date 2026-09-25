import { t } from 'elysia';
import {
  RECORD_SORT_FIELDS,
  type RecordResource,
  type RecordSummary,
} from '#backend/models/records/model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#backend/routes/api/model.ts';
import {
  KnowledgePageSummarySchema,
  pageSummaryResponse,
} from '#backend/routes/api/pages/model.ts';
import { PublicationVisibilitySchema } from '#backend/routes/api/publications/model.ts';

export const RecordSummarySchema = t.Object({
  readableId: ReadableIdSchema,
  title: t.String({ minLength: 1 }),
  source: t.Object({
    provider: t.String(),
    kind: t.String(),
    id: t.String(),
    url: t.Nullable(t.String()),
  }),
  sourceCreatedAt: t.Nullable(t.String({ format: 'date-time' })),
  sourceUpdatedAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const RecordSchema = t.Object({
  ...RecordSummarySchema.properties,
  body: t.String(),
  backlinks: t.Array(KnowledgePageSummarySchema),
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
  visibility: t.Optional(PublicationVisibilitySchema),
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
    source: record.source,
    sourceCreatedAt: record.sourceCreatedAt,
    sourceUpdatedAt: record.sourceUpdatedAt,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function recordResponse(record: RecordResource) {
  return {
    ...recordSummaryResponse(record),
    body: record.body,
    backlinks: record.backlinks.map(pageSummaryResponse),
  };
}
