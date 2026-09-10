import { t } from 'elysia';
import type { RecordSync } from '#models/syncs/model.ts';
import { MAX_SYNC_NAME_LENGTH, UUID_V7_PATTERN } from '#models/syncs/model.ts';
import { ReadableIdSchema } from '#routes/api/model.ts';

export const RecordSyncSchema = t.Object({
  readableId: ReadableIdSchema,
  name: t.String({ minLength: 1, maxLength: MAX_SYNC_NAME_LENGTH }),
  createdAt: t.String(),
  revokedAt: t.Nullable(t.String()),
});

export const RecordSyncListSchema = t.Object({ items: t.Array(RecordSyncSchema) });

export const CreateRecordSyncBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: MAX_SYNC_NAME_LENGTH }),
});

export const CreateRecordSyncResponseSchema = t.Object({
  sync: RecordSyncSchema,
  apiKey: t.String({ pattern: UUID_V7_PATTERN.source }),
});

export const RecordSyncParamsSchema = t.Object({ syncReadableId: ReadableIdSchema });

export function recordSyncResponse(sync: RecordSync) {
  return {
    readableId: sync.readableId,
    name: sync.name,
    createdAt: sync.createdAt,
    revokedAt: sync.revokedAt,
  };
}
