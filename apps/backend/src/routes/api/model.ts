import { t } from 'elysia';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#models/readable-ids/model.ts';

export const DEFAULT_LIST_LIMIT = 30;
export const MAX_LIST_LIMIT = 50;

export const PaginationQuerySchema = t.Object({
  limit: t.Optional(
    t.Numeric({ minimum: 1, maximum: MAX_LIST_LIMIT, default: DEFAULT_LIST_LIMIT }),
  ),
  offset: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
});

export const PaginationMetadataSchema = t.Object({
  total: t.Integer({ minimum: 0 }),
  nextOffset: t.Nullable(t.Integer({ minimum: 0 })),
});

export const ReadableIdSchema = t.String({
  minLength: 1,
  maxLength: MAX_READABLE_ID_LENGTH,
  pattern: READABLE_ID_PATTERN.source,
});

export const ResourceNameConflictSchema = t.Object({
  error: t.String(),
  nameConflict: t.Literal(true),
});
