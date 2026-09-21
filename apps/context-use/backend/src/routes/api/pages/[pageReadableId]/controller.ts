import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import {
  KnowledgePageParamsSchema,
  KnowledgePagePreviewSchema,
  KnowledgePageSchema,
  knowledgePagePreviewResponse,
  knowledgePageResponse,
  UpdateKnowledgePageBodySchema,
} from '#backend/routes/api/pages/model.ts';
import {
  ResourceInUseResponseSchema,
  resourceInUseResponse,
} from '#backend/routes/api/resource-archiving/model.ts';
import type { KnowledgePagesServiceContract } from '#backend/services/knowledge-pages/service.ts';
import {
  KnowledgePageDiffQuerySchema,
  KnowledgePageDiffSchema,
  knowledgePageDiffResponse,
} from './diff/model.ts';

export function createPageReadableIdController({
  auth,
  pagesService,
}: {
  auth: Auth;
  pagesService: KnowledgePagesServiceContract;
}) {
  return new Elysia()
    .use(changeMessagePlugin)
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .get(
      '/pages/:pageReadableId/diff',
      async ({ params, query, user, status }) => {
        const result = await pagesService.diff({
          ownerId: user.id,
          readableId: params.pageReadableId,
          ...query,
        });
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Knowledge page revision not found' });
        }
        if (result.state === 'too_large') {
          return status(StatusMap['Unprocessable Content'], {
            error: 'This comparison is too large to display.',
          });
        }
        return status(StatusMap.OK, knowledgePageDiffResponse(result.diff));
      },
      {
        detail: { tags: ['Pages'], summary: 'Compare two knowledge page revisions' },
        params: KnowledgePageParamsSchema,
        query: KnowledgePageDiffQuerySchema,
        response: {
          [StatusMap.OK]: KnowledgePageDiffSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
          [StatusMap['Unprocessable Content']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages/:pageReadableId/preview',
      async ({ params, user, status }) => {
        const page = await pagesService.preview({
          ownerId: user.id,
          readableId: params.pageReadableId,
        });
        return page
          ? status(StatusMap.OK, knowledgePagePreviewResponse(page))
          : status(StatusMap['Not Found'], { error: 'Knowledge page not found' });
      },
      {
        detail: { tags: ['Pages'], summary: 'Read a knowledge page preview' },
        params: KnowledgePageParamsSchema,
        response: {
          [StatusMap.OK]: KnowledgePagePreviewSchema,
          [StatusMap['Not Found']]: ErrorResponseSchema,
        },
      },
    )
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
          message: body.changeMessage,
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
        changeMessage: true,
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
      async ({ body, params, user, status }) => {
        const result = await pagesService.archive({
          change: { actor: { kind: 'owner' }, message: body.changeMessage },
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
        changeMessage: true,
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
