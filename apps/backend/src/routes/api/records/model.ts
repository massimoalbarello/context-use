import { t } from 'elysia';
import type {
  OpenConnectorRecordResource,
  OpenConnectorRecordSummary,
} from '#models/open-connector/model.ts';
import {
  MAX_OPEN_CONNECTOR_INTEGRATION_NAME_LENGTH,
  MAX_OPEN_CONNECTOR_RECORD_EXCERPT_LENGTH,
  MAX_OPEN_CONNECTOR_RECORD_TITLE_LENGTH,
  OPEN_CONNECTOR_INTEGRATION_ID_PATTERN,
} from '#models/open-connector/model.ts';
import { PaginationQuerySchema, ReadableIdSchema } from '#routes/api/model.ts';

export const ExternalServiceSchema = t.Object({
  id: t.String({
    minLength: 1,
    maxLength: 128,
    pattern: OPEN_CONNECTOR_INTEGRATION_ID_PATTERN.source,
  }),
  name: t.String({ minLength: 1, maxLength: MAX_OPEN_CONNECTOR_INTEGRATION_NAME_LENGTH }),
});

export const RecordSummarySchema = t.Object({
  readableId: ReadableIdSchema,
  title: t.String({ minLength: 1, maxLength: MAX_OPEN_CONNECTOR_RECORD_TITLE_LENGTH }),
  excerpt: t.String({ minLength: 1, maxLength: MAX_OPEN_CONNECTOR_RECORD_EXCERPT_LENGTH }),
  externalService: ExternalServiceSchema,
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

export function recordSummaryResponse(record: OpenConnectorRecordSummary) {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function recordResponse(record: OpenConnectorRecordResource) {
  return { ...recordSummaryResponse(record), markdown: record.markdown };
}
