import { t } from 'elysia';
import type { KnowledgePageReference } from '#models/knowledge-pages/model.ts';
import { KnowledgePageReferenceSchema, pageSummaryResponse } from '#routes/api/pages/model.ts';

export const ResourceInUseResponseSchema = t.Object({
  error: t.String(),
  blockers: t.Array(KnowledgePageReferenceSchema),
});

export function resourceInUseResponse(blockers: KnowledgePageReference[]) {
  return {
    error: 'Remove or replace every active inbound relationship before archiving this resource.',
    blockers: blockers.map(({ page, fragment }) => ({
      page: pageSummaryResponse(page),
      fragment,
    })),
  };
}
