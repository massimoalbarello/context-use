import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  CreateKnowledgePageBodySchema,
  KnowledgePageListSchema,
  KnowledgePageSchema,
  knowledgePageResponse,
  pageSummaryResponse,
} from '#routes/api/pages/model.ts';
import type { KnowledgePagesServiceContract } from '#services/knowledge-pages.service.ts';

export function createPagesController({
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
    .post(
      '/pages',
      async ({ body, user, status }) => {
        const result = await pagesService.create({ ownerId: user.id, ...body });
        if (result.state === 'saved') {
          return status(StatusMap.Created, knowledgePageResponse(result.page));
        }
        if (result.state === 'readable_id_conflict') {
          return status(StatusMap.Conflict, { error: 'Page readable ID already exists' });
        }
        if (result.state === 'link_target_not_found') {
          return status(StatusMap['Bad Request'], {
            error: `Link target not found: ${result.target}`,
          });
        }
        if (result.state === 'invalid_markdown') {
          return status(StatusMap['Bad Request'], { error: result.message });
        }
        return status(StatusMap['Internal Server Error'], { error: 'Page creation failed' });
      },
      {
        detail: { tags: ['Pages'], summary: 'Create a knowledge page' },
        body: CreateKnowledgePageBodySchema,
        response: {
          [StatusMap.Created]: KnowledgePageSchema,
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/pages',
      async ({ user, status }) => {
        const pages = await pagesService.list({ ownerId: user.id });
        return status(StatusMap.OK, pages.map(pageSummaryResponse));
      },
      {
        detail: { tags: ['Pages'], summary: 'List current knowledge pages' },
        response: { [StatusMap.OK]: KnowledgePageListSchema },
      },
    );
}
