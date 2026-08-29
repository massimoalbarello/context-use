import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  EntityBodySchema,
  EntityListSchema,
  EntitySchema,
  entityResponse,
} from '#routes/api/entities/model.ts';
import { ReadableIdConflictSchema, ReadableIdRequiredSchema } from '#routes/api/model.ts';
import type { EntitiesServiceContract } from '#services/entities.service.ts';

export function createEntitiesController({
  auth,
  entitiesService,
}: {
  auth: Auth;
  entitiesService: EntitiesServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: { [StatusMap.Unauthorized]: ErrorResponseSchema },
    })
    .post(
      '/entities',
      async ({ body, user, status }) => {
        const result = await entitiesService.create({ ownerId: user.id, ...body });
        if (result.state === 'readable_id_conflict') {
          return status(StatusMap.Conflict, {
            error: 'An entity already uses this readable ID',
            readableId: result.readableId,
          });
        }
        if (result.state === 'readable_id_required') {
          return status(StatusMap['Bad Request'], {
            error: 'A readable ID could not be derived from this name',
            readableIdRequired: true as const,
          });
        }
        return status(StatusMap.Created, entityResponse(result.entity));
      },
      {
        detail: { tags: ['Entities'], summary: 'Create an entity identity' },
        body: EntityBodySchema,
        response: {
          [StatusMap.Created]: EntitySchema,
          [StatusMap['Bad Request']]: t.Union([ReadableIdRequiredSchema, ErrorResponseSchema]),
          [StatusMap.Conflict]: ReadableIdConflictSchema,
        },
      },
    )
    .get(
      '/entities',
      async ({ user, status }) => {
        const entities = await entitiesService.list({ ownerId: user.id });
        return status(StatusMap.OK, entities.map(entityResponse));
      },
      {
        detail: { tags: ['Entities'], summary: 'List entity identities' },
        response: { [StatusMap.OK]: EntityListSchema },
      },
    );
}
