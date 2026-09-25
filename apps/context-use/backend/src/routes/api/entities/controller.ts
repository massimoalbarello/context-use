import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import { changeMessagePlugin } from '#backend/routes/api/change-message.ts';
import {
  CreateEntityBodySchema,
  EntityListQuerySchema,
  EntityListSchema,
  EntitySchema,
  entityResponse,
} from '#backend/routes/api/entities/model.ts';
import { DEFAULT_LIST_LIMIT, ResourceNameConflictSchema } from '#backend/routes/api/model.ts';
import type { EntitiesServiceContract } from '#backend/services/entities/service.ts';

export function createEntitiesController({
  auth,
  entitiesService,
}: {
  auth: Auth;
  entitiesService: EntitiesServiceContract;
}) {
  return new Elysia()
    .use(changeMessagePlugin)
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .post(
      '/entities',
      async ({ body, user, status }) => {
        const result = await entitiesService.create({
          change: { clientName: null, message: body.changeMessage },
          ownerId: user.id,
          ...body,
        });
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, {
            error:
              'An entity with this name already exists. Use a more specific name or keep this name anyway.',
            nameConflict: true as const,
          });
        }
        return status(StatusMap.Created, entityResponse(result.entity));
      },
      {
        changeMessage: true,
        detail: { tags: ['Entities'], summary: 'Create an entity identity' },
        body: CreateEntityBodySchema,
        response: {
          [StatusMap.Created]: EntitySchema,
          [StatusMap.Conflict]: ResourceNameConflictSchema,
        },
      },
    )
    .get(
      '/entities',
      async ({ query, user, status }) => {
        const page = await entitiesService.list({
          ownerId: user.id,
          limit: query.limit ?? DEFAULT_LIST_LIMIT,
          offset: query.offset ?? 0,
          visibility: query.visibility,
          entityType: query.entityType,
        });
        return status(StatusMap.OK, { ...page, items: page.items.map(entityResponse) });
      },
      {
        detail: { tags: ['Entities'], summary: 'List entity identities' },
        query: EntityListQuerySchema,
        response: { [StatusMap.OK]: EntityListSchema },
      },
    );
}
