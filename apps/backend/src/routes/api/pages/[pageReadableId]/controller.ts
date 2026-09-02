import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  KnowledgePageParamsSchema,
  KnowledgePageSchema,
  knowledgePageResponse,
  UpdateKnowledgePageBodySchema,
} from '#routes/api/pages/model.ts';
import {
  ResourceInUseResponseSchema,
  resourceInUseResponse,
} from '#routes/api/resource-archiving/model.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages/service.ts';

export function createPageReadableIdController({
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
      '/pages/:pageReadableId',
      async ({ params, user, status }) => {
        const page = await pagesService.detail({
          ownerId: user.id,
          readableId: params.pageReadableId,
        });
        return page
          ? status(StatusMap.OK, knowledgePageResponse(page))
          : status(StatusMap['Not Found'], { error: 'Knowledge page not found' });
      },
      {
        detail: { tags: ['Pages'], summary: 'Read a knowledge page and its links' },
        params: KnowledgePageParamsSchema,
        response: {
          [StatusMap.OK]: KnowledgePageSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/pages/:pageReadableId',
      async ({ body, params, user, status }) => {
        const result = await pagesService.update({
          ownerId: user.id,
          actor: { kind: 'owner' },
          readableId: params.pageReadableId,
          ...body,
        });
        if (result.state === 'saved') {
          return status(StatusMap.OK, knowledgePageResponse(result.page));
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Knowledge page not found' });
        }
        if (result.state === 'revision_conflict') {
          return status(StatusMap.Conflict, {
            error: `Page changed; current revision is ${result.currentRevisionNumber}`,
          });
        }
        if (result.state === 'link_target_not_found') {
          return status(StatusMap['Bad Request'], {
            error: `Link target not found: ${result.target}`,
          });
        }
        if (result.state === 'invalid_markdown' || result.state === 'invalid_temporal_coverage') {
          return status(StatusMap['Bad Request'], { error: result.message });
        }
        return status(StatusMap['Internal Server Error'], { error: 'Page update failed' });
      },
      {
        detail: { tags: ['Pages'], summary: 'Create a new knowledge page revision' },
        params: KnowledgePageParamsSchema,
        body: UpdateKnowledgePageBodySchema,
        response: {
          [StatusMap.OK]: KnowledgePageSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/pages/:pageReadableId/archive',
      async ({ params, user, status }) => {
        const result = await pagesService.archive({
          ownerId: user.id,
          readableId: params.pageReadableId,
        });
        if (result.state === 'resource_in_use') {
          return status(StatusMap.Conflict, resourceInUseResponse(result.blockers));
        }
        return result.state === 'archived'
          ? status(StatusMap['No Content'], undefined)
          : status(StatusMap['Not Found'], { error: 'Knowledge page not found' });
      },
      {
        detail: { tags: ['Pages'], summary: 'Archive a knowledge page' },
        params: KnowledgePageParamsSchema,
        response: {
          [StatusMap['No Content']]: t.Void(),
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap.Conflict]: ResourceInUseResponseSchema,
        },
      },
    );
}
