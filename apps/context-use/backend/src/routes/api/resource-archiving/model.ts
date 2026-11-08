import { t } from 'elysia';
import type { KnowledgePageReference } from '#backend/models/knowledge-pages/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';
import {
  KnowledgePageReferenceSchema,
  pageSummaryResponse,
} from '#backend/routes/api/pages/model.ts';

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

export const UnarchiveBlockedSchema = t.Object({
  error: t.String(),
  blockers: t.Array(
    t.Object({
      resourceType: t.UnionEnum(['entity', 'page', 'asset']),
      readableId: ReadableIdSchema,
      name: t.String(),
    }),
  ),
});
