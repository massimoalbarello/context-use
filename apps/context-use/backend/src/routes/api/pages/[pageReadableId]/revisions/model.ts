import { t } from 'elysia';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#backend/models/knowledge-pages/temporal-coverage.ts';
import { KnowledgePageParamsSchema } from '#backend/routes/api/pages/model.ts';

export const KnowledgePageRevisionParamsSchema = t.Object({
  ...KnowledgePageParamsSchema.properties,
  revisionNumber: t.Numeric({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 }),
});

export const KnowledgePageRevisionSchema = t.Object({
  revisionNumber: t.Integer({ minimum: 1 }),
  markdown: t.String(),
  temporalCoverage: t.Nullable(t.String({ maxLength: MAX_TEMPORAL_COVERAGE_LENGTH })),
});
