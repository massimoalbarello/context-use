import { t } from 'elysia';
import type { KnowledgePageDiff } from '#backend/models/knowledge-pages/diff.ts';
import { MAX_TEMPORAL_COVERAGE_LENGTH } from '#backend/models/knowledge-pages/temporal-coverage.ts';

export const KnowledgePageDiffQuerySchema = t.Object({
  from: t.Numeric({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    multipleOf: 1,
    description: 'Source revision number; 0 compares against an empty page.',
  }),
  to: t.Numeric({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 }),
});

const CoverageSchema = t.Nullable(t.String({ maxLength: MAX_TEMPORAL_COVERAGE_LENGTH }));

export const KnowledgePageDiffSchema = t.Object({
  from: t.Integer({ minimum: 0 }),
  to: t.Integer({ minimum: 1 }),
  additions: t.Integer({ minimum: 0 }),
  deletions: t.Integer({ minimum: 0 }),
  hunks: t.Array(
    t.Object({
      oldStart: t.Integer({ minimum: 0 }),
      oldLines: t.Integer({ minimum: 0 }),
      newStart: t.Integer({ minimum: 0 }),
      newLines: t.Integer({ minimum: 0 }),
      lines: t.Array(t.String()),
    }),
  ),
  temporalCoverage: t.Nullable(t.Object({ from: CoverageSchema, to: CoverageSchema })),
});

export function knowledgePageDiffResponse(diff: KnowledgePageDiff) {
  return {
    from: diff.from,
    to: diff.to,
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks.map(({ oldStart, oldLines, newStart, newLines, lines }) => ({
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines,
    })),
    temporalCoverage: diff.temporalCoverage,
  };
}
