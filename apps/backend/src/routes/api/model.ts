import { t } from 'elysia';
import { MAX_READABLE_ID_LENGTH, READABLE_ID_PATTERN } from '#knowledge/knowledge-address.ts';

export const ReadableIdSchema = t.String({
  minLength: 1,
  maxLength: MAX_READABLE_ID_LENGTH,
  pattern: READABLE_ID_PATTERN.source,
});

export const ReadableIdConflictSchema = t.Object({
  error: t.String(),
  readableId: ReadableIdSchema,
});

export const ReadableIdRequiredSchema = t.Object({
  error: t.String(),
  readableIdRequired: t.Literal(true),
});
