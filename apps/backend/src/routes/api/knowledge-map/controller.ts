import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT,
  decodeKnowledgeMapCursor,
  KnowledgeMapQuerySchema,
  KnowledgeMapSchema,
  knowledgeMapResponse,
} from '#routes/api/knowledge-map/model.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';

export function createKnowledgeMapController({
  auth,
  pagesService,
}: {
  auth: Auth;
  pagesService: KnowledgePagesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .get(
      '/knowledge-map',
      async ({ query, user, status }) => {
        const decodedCursor = decodeKnowledgeMapCursor(query.cursor);
        if (decodedCursor.state === 'invalid') {
          return status(StatusMap['Bad Request'], {
            error: 'The knowledge-map cursor is invalid. Restart from the initial neighborhood.',
          });
        }
        const map = await pagesService.map({
          ownerId: user.id,
          limit: query.limit ?? DEFAULT_KNOWLEDGE_MAP_PAGE_LIMIT,
          cursor: decodedCursor.cursor,
        });
        return status(StatusMap.OK, knowledgeMapResponse(map));
      },
      {
        detail: { tags: ['Pages'], summary: 'Read a bounded projection of the knowledge map' },
        query: KnowledgeMapQuerySchema,
        response: {
          [StatusMap.OK]: KnowledgeMapSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
        },
      },
    );
}
